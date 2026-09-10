#include <filesystem>
#include <unordered_map>
#include <unordered_set>
#include <cstring>
#include <gtk/gtk.h>

#include "webview.hpp"
#include "webview_impl.h"
#include "../../utils/mime.hpp"
#include "./glib_exception.h"
#include "./util/convert_js_result.h"

extern "C" {
    extern char BIN2CODE_DG_PRELOAD_GTK_JS_CONTENT[];
    extern int BIN2CODE_DG_PRELOAD_GTK_JS_SIZE;
}
namespace fs = std::filesystem;

namespace {
    const gchar* localURLScheme = "deskgap-local";
    std::unordered_map<std::string, WebKitWebContext*> contextsBySessionId;
    std::unordered_set<WebKitWebContext*> contextsWithLocalScheme;
    std::unordered_map<WebKitWebContext*, std::unordered_set<std::string>> customSchemesByContext;

    WebKitWebContext* ContextForSession(const DeskGap::WebView::SessionOptions& session) {
        auto existing = contextsBySessionId.find(session.id);
        if (existing != contextsBySessionId.end()) return existing->second;

        WebKitWebsiteDataManager* dataManager;
        if (session.kind == "ephemeral") {
            dataManager = webkit_website_data_manager_new_ephemeral();
        }
        else if (session.dataPath.has_value()) {
            std::string cachePath = (fs::path(*session.dataPath) / "Cache").string();
            dataManager = webkit_website_data_manager_new(
                "base-data-directory", session.dataPath->c_str(),
                "base-cache-directory", cachePath.c_str(),
                nullptr
            );
        }
        else {
            dataManager = webkit_website_data_manager_new(nullptr);
        }

        WebKitWebContext* context = webkit_web_context_new_with_website_data_manager(dataManager);
        g_object_unref(dataManager);
        if (session.proxyRules.has_value()) {
            if (*session.proxyRules == "direct://") {
                webkit_web_context_set_network_proxy_settings(
                    context, WEBKIT_NETWORK_PROXY_MODE_NO_PROXY, nullptr
                );
            }
            else {
                gchar** ignoreHosts = session.proxyBypassRules.has_value()
                    ? g_strsplit_set(session.proxyBypassRules->c_str(), ",;", -1)
                    : nullptr;
                WebKitNetworkProxySettings* settings = webkit_network_proxy_settings_new(
                    session.proxyRules->c_str(), ignoreHosts
                );
                webkit_web_context_set_network_proxy_settings(
                    context, WEBKIT_NETWORK_PROXY_MODE_CUSTOM, settings
                );
                webkit_network_proxy_settings_free(settings);
                g_strfreev(ignoreHosts);
            }
        }
        contextsBySessionId.emplace(session.id, context);
        return context;
    }

    gboolean HandleContextMenu(WebKitWebView*, WebKitContextMenu *menu, GdkEvent*, WebKitHitTestResult*, gpointer) {
        static const std::unordered_set<WebKitContextMenuAction> kActionsToBeDeleted {
            WEBKIT_CONTEXT_MENU_ACTION_OPEN_LINK,
            WEBKIT_CONTEXT_MENU_ACTION_OPEN_LINK_IN_NEW_WINDOW,
            WEBKIT_CONTEXT_MENU_ACTION_DOWNLOAD_LINK_TO_DISK,
            WEBKIT_CONTEXT_MENU_ACTION_COPY_LINK_TO_CLIPBOARD,
            WEBKIT_CONTEXT_MENU_ACTION_OPEN_IMAGE_IN_NEW_WINDOW,
            WEBKIT_CONTEXT_MENU_ACTION_DOWNLOAD_IMAGE_TO_DISK,
            WEBKIT_CONTEXT_MENU_ACTION_COPY_IMAGE_TO_CLIPBOARD,
            WEBKIT_CONTEXT_MENU_ACTION_COPY_IMAGE_URL_TO_CLIPBOARD,
            WEBKIT_CONTEXT_MENU_ACTION_OPEN_FRAME_IN_NEW_WINDOW,
            WEBKIT_CONTEXT_MENU_ACTION_GO_BACK,
            WEBKIT_CONTEXT_MENU_ACTION_GO_FORWARD,
            WEBKIT_CONTEXT_MENU_ACTION_STOP,
            WEBKIT_CONTEXT_MENU_ACTION_RELOAD,
            WEBKIT_CONTEXT_MENU_ACTION_OPEN_VIDEO_IN_NEW_WINDOW,
            WEBKIT_CONTEXT_MENU_ACTION_OPEN_AUDIO_IN_NEW_WINDOW,
            WEBKIT_CONTEXT_MENU_ACTION_COPY_VIDEO_LINK_TO_CLIPBOARD,
            WEBKIT_CONTEXT_MENU_ACTION_COPY_AUDIO_LINK_TO_CLIPBOARD,
            WEBKIT_CONTEXT_MENU_ACTION_DOWNLOAD_VIDEO_TO_DISK,
            WEBKIT_CONTEXT_MENU_ACTION_DOWNLOAD_AUDIO_TO_DISK,
        };

        guint itemCount = webkit_context_menu_get_n_items(menu);
        for (gint i = itemCount - 1; i >= 0; --i) {
            WebKitContextMenuItem* item = webkit_context_menu_get_item_at_position(menu, i);
            WebKitContextMenuAction action = webkit_context_menu_item_get_stock_action(item);
            if (kActionsToBeDeleted.find(action) != kActionsToBeDeleted.end()) {
                webkit_context_menu_remove(menu, item);
            }
        }
        if (webkit_context_menu_get_n_items(menu) == 0) {
            return TRUE;
        }
        return FALSE;
    }
}

namespace DeskGap {

    void WebView::Impl::HandleLocalFileUriSchemeRequest(WebKitURISchemeRequest *request, gpointer) {
        WebKitWebView* requestWebView = webkit_uri_scheme_request_get_web_view(request);
        WebView* webView = requestWebView == nullptr
            ? nullptr
            : static_cast<WebView*>(g_object_get_data(G_OBJECT(requestWebView), "deskgap-webview"));
        if (webView == nullptr) {
            GError *error = g_error_new(WEBKIT_NETWORK_ERROR, 404, "Unknown DeskGap webview");
            webkit_uri_scheme_request_finish_error(request, error);
            g_error_free(error);
            return;
        }
        const auto& servedPath = webView->impl_->servedPath;
        if (!servedPath.has_value()) {
            GError *error = g_error_new(WEBKIT_NETWORK_ERROR, 404, "Requesting Local Files Not Allowed");
            webkit_uri_scheme_request_finish_error (request, error);
            g_error_free(error);
            return;
        }
        
        const gchar* urlPath = webkit_uri_scheme_request_get_path(request);

        const gchar* encodedFilename = urlPath;
        while (*encodedFilename == '/') ++encodedFilename;

        gchar* fileContent;
        gchar* fullPath = nullptr;
        gsize fileSize;
        std::string fileExtension;
        {
            {
                gchar* filename = g_uri_unescape_string(encodedFilename, nullptr);
                if (filename == nullptr) {
                    GError* pathError = g_error_new(WEBKIT_NETWORK_ERROR, 404, "Invalid local path encoding");
                    webkit_uri_scheme_request_finish_error(request, pathError);
                    g_error_free(pathError);
                    return;
                }

                std::error_code error;
                fs::path rootPath = fs::canonical(servedPath.value(), error);
                fs::path requestedPath = error ? fs::path() : fs::canonical(rootPath / filename, error);
                bool isInsideRoot = !error;
                if (isInsideRoot) {
                    auto rootPart = rootPath.begin();
                    auto requestedPart = requestedPath.begin();
                    for (; rootPart != rootPath.end(); ++rootPart, ++requestedPart) {
                        if (requestedPart == requestedPath.end() || *rootPart != *requestedPart) {
                            isInsideRoot = false;
                            break;
                        }
                    }
                }
                if (!isInsideRoot) {
                    g_free(filename);
                    GError* pathError = g_error_new(WEBKIT_NETWORK_ERROR, 404, "Local path is outside the application root");
                    webkit_uri_scheme_request_finish_error(request, pathError);
                    g_error_free(pathError);
                    return;
                }
                fullPath = g_strdup(requestedPath.string().c_str());

                if (const char* firstDot = std::strrchr(filename, '.'); firstDot != nullptr) {
                    fileExtension = std::string(firstDot + 1);
                }
                g_free(filename);
            }
            GError* error = nullptr;
            g_file_get_contents(fullPath, &fileContent, &fileSize, &error);

            if (error != nullptr) {
                webkit_uri_scheme_request_finish_error(request, error);
                g_error_free(error);
                g_free(fullPath);
                return;
            }
        }

        GInputStream *stream = g_memory_input_stream_new_from_data(fileContent, fileSize, g_free);
        webkit_uri_scheme_request_finish(request, stream, fileSize, DeskGap::GetMimeTypeOfExtension(fileExtension).c_str());
        g_object_unref(stream);
        g_free(fullPath);
    }

    void WebView::Impl::HandleCustomUriSchemeRequest(WebKitURISchemeRequest* request, gpointer) {
        WebKitWebView* requestWebView = webkit_uri_scheme_request_get_web_view(request);
        WebView* webView = requestWebView == nullptr
            ? nullptr
            : static_cast<WebView*>(g_object_get_data(G_OBJECT(requestWebView), "deskgap-webview"));
        if (webView == nullptr) {
            GError* error = g_error_new(WEBKIT_NETWORK_ERROR, 404, "Unknown DeskGap webview");
            webkit_uri_scheme_request_finish_error(request, error);
            g_error_free(error);
            return;
        }

        uint64_t requestId = webView->impl_->nextProtocolRequestId++;
        webView->impl_->pendingProtocolRequests.emplace(
            requestId, WEBKIT_URI_SCHEME_REQUEST(g_object_ref(request))
        );
        std::vector<WebView::HTTPHeader> headers;
        SoupMessageHeaders* requestHeaders = webkit_uri_scheme_request_get_http_headers(request);
        if (requestHeaders != nullptr) {
            soup_message_headers_foreach(
                requestHeaders,
                [](const char* name, const char* value, gpointer data) {
                    static_cast<std::vector<WebView::HTTPHeader>*>(data)->push_back({ name, value });
                },
                &headers
            );
        }
        const char* method = webkit_uri_scheme_request_get_http_method(request);
        const char* uri = webkit_uri_scheme_request_get_uri(request);
        webView->impl_->callbacks.onCustomProtocolRequest(
            requestId,
            method == nullptr ? "GET" : method,
            uri == nullptr ? "" : uri,
            std::move(headers)
        );
    }

    void WebView::Impl::ResolveCustomProtocolRequest(
        uint64_t requestId,
        int statusCode,
        const std::string& statusText,
        const std::vector<WebView::HTTPHeader>& headers,
        std::vector<uint8_t>&& body
    ) {
        auto pending = pendingProtocolRequests.find(requestId);
        if (pending == pendingProtocolRequests.end()) return;
        WebKitURISchemeRequest* request = pending->second;
        pendingProtocolRequests.erase(pending);

        GBytes* bytes = g_bytes_new(body.data(), body.size());
        GInputStream* stream = g_memory_input_stream_new_from_bytes(bytes);
        WebKitURISchemeResponse* response = webkit_uri_scheme_response_new(stream, body.size());
        webkit_uri_scheme_response_set_status(response, statusCode, statusText.c_str());
        SoupMessageHeaders* responseHeaders = soup_message_headers_new(SOUP_MESSAGE_HEADERS_RESPONSE);
        for (const auto& header : headers) {
            soup_message_headers_append(responseHeaders, header.field.c_str(), header.value.c_str());
        }
        webkit_uri_scheme_response_set_http_headers(response, responseHeaders);
        webkit_uri_scheme_request_finish_with_response(request, response);
        soup_message_headers_unref(responseHeaders);
        g_object_unref(response);
        g_object_unref(stream);
        g_bytes_unref(bytes);
        g_object_unref(request);
    }


    void WebView::Impl::HandleLoadChanged(GtkWidget*, WebKitLoadEvent loadEvent, WebView* webView) {
        switch (loadEvent) {
        case WEBKIT_LOAD_STARTED:
        {
            const char* uri = webkit_web_view_get_uri(webView->impl_->gtkWebView);
            webView->impl_->callbacks.didStartNavigation(
                uri == nullptr ? "" : uri, false
            );
            break;
        }
        case WEBKIT_LOAD_REDIRECTED:
        {
            const char* uri = webkit_web_view_get_uri(webView->impl_->gtkWebView);
            webView->impl_->callbacks.didStartNavigation(
                uri == nullptr ? "" : uri, true
            );
            break;
        }
        case WEBKIT_LOAD_FINISHED:
            webView->impl_->callbacks.didFinishLoad();
            break;
        default:
            break;
        }
    }

    gboolean WebView::Impl::HandleLoadFailed(
        WebKitWebView*, WebKitLoadEvent, const gchar* failingUri, GError* error, WebView* webView
    ) {
        webView->impl_->callbacks.didFailLoad(
            error == nullptr ? 0 : error->code,
            error == nullptr ? "Navigation failed" : error->message,
            failingUri == nullptr ? "" : failingUri
        );
        return FALSE;
    }

    gboolean WebView::Impl::HandleDecidePolicy(
        WebKitWebView*, WebKitPolicyDecision* decision, WebKitPolicyDecisionType type, WebView* webView
    ) {
        if (type != WEBKIT_POLICY_DECISION_TYPE_NAVIGATION_ACTION
            && type != WEBKIT_POLICY_DECISION_TYPE_NEW_WINDOW_ACTION) {
            return FALSE;
        }
        WebKitNavigationAction* action = webkit_navigation_policy_decision_get_navigation_action(
            WEBKIT_NAVIGATION_POLICY_DECISION(decision)
        );
        WebKitURIRequest* request = webkit_navigation_action_get_request(action);
        const char* uri = webkit_uri_request_get_uri(request);
        std::string url = uri == nullptr ? "" : uri;
        if (type == WEBKIT_POLICY_DECISION_TYPE_NEW_WINDOW_ACTION) {
            const char* frameName = webkit_navigation_policy_decision_get_frame_name(
                WEBKIT_NAVIGATION_POLICY_DECISION(decision)
            );
            webkit_policy_decision_ignore(decision);
            webView->impl_->callbacks.onNewWindowRequested(
                url, frameName == nullptr ? "" : frameName, ""
            );
            return TRUE;
        }
        if (webView->impl_->allowedNavigationUrl.has_value()
            && *webView->impl_->allowedNavigationUrl == url) {
            webView->impl_->allowedNavigationUrl.reset();
            return FALSE;
        }
        uint64_t requestId = webView->impl_->nextPolicyRequestId++;
        webView->impl_->pendingNavigationPolicies.emplace(
            requestId, WEBKIT_POLICY_DECISION(g_object_ref(decision))
        );
        webView->impl_->callbacks.onNavigationPolicyRequest(requestId, url, false);
        return TRUE;
    }

    void WebView::Impl::ResolveNavigationPolicy(uint64_t requestId, bool allow) {
        auto request = pendingNavigationPolicies.find(requestId);
        if (request == pendingNavigationPolicies.end()) return;
        WebKitPolicyDecision* decision = request->second;
        pendingNavigationPolicies.erase(request);
        if (allow) webkit_policy_decision_use(decision);
        else webkit_policy_decision_ignore(decision);
        g_object_unref(decision);
    }

    void WebView::Impl::HandleWebProcessTerminated(
        WebKitWebView*, WebKitWebProcessTerminationReason reason, WebView* webView
    ) {
        const char* reasonName = "crashed";
        switch (reason) {
        case WEBKIT_WEB_PROCESS_EXCEEDED_MEMORY_LIMIT: reasonName = "oom"; break;
        case WEBKIT_WEB_PROCESS_TERMINATED_BY_API: reasonName = "killed"; break;
        default: break;
        }
        webView->impl_->callbacks.onRenderProcessGone(reasonName, -1);
    }

    WebView::WebView(
        EventCallbacks&& callbacks,
        const std::string& preloadScriptString,
        SessionOptions&& session
    ): impl_(std::make_unique<Impl>()) {
        impl_->callbacks = std::move(callbacks);
        {
            WebKitWebContext* context = ContextForSession(session);
            if (contextsWithLocalScheme.insert(context).second) {
                webkit_web_context_register_uri_scheme(
                    context,
                    localURLScheme, Impl::HandleLocalFileUriSchemeRequest,
                    nullptr, nullptr
                );
            }
            auto& registeredCustomSchemes = customSchemesByContext[context];
            WebKitSecurityManager* securityManager = webkit_web_context_get_security_manager(context);
            for (const auto& scheme : session.customSchemes) {
                if (registeredCustomSchemes.insert(scheme.name).second) {
                    webkit_web_context_register_uri_scheme(
                        context,
                        scheme.name.c_str(), Impl::HandleCustomUriSchemeRequest,
                        nullptr, nullptr
                    );
                    webkit_security_manager_register_uri_scheme_as_cors_enabled(
                        securityManager, scheme.name.c_str()
                    );
                }
            }

            impl_->gtkWebView = WEBKIT_WEB_VIEW(g_object_ref_sink(webkit_web_view_new_with_context(context)));
            g_object_set_data(G_OBJECT(impl_->gtkWebView), "deskgap-webview", this);
        }

        {
            WebKitSettings* settings = webkit_web_view_get_settings(impl_->gtkWebView);
            if (session.userAgent.has_value()) {
                webkit_settings_set_user_agent(settings, session.userAgent->c_str());
            }
            webkit_settings_set_javascript_can_access_clipboard(settings, true);
        }


        std::string preloadScript(BIN2CODE_DG_PRELOAD_GTK_JS_CONTENT, BIN2CODE_DG_PRELOAD_GTK_JS_SIZE);
        preloadScript.reserve(BIN2CODE_DG_PRELOAD_GTK_JS_SIZE);
        preloadScript.assign(BIN2CODE_DG_PRELOAD_GTK_JS_CONTENT, BIN2CODE_DG_PRELOAD_GTK_JS_SIZE);
        preloadScript.append(preloadScriptString);
        {
            WebKitUserContentManager* manager = webkit_web_view_get_user_content_manager(impl_->gtkWebView);

            impl_->scriptWindowDragConnection = g_signal_connect(
                manager,
                "script-message-received::windowDrag",
                G_CALLBACK(Impl::HandleScriptWindowDrag),
                this
            );
            webkit_user_content_manager_register_script_message_handler(manager, "windowDrag");

            impl_->scriptConsoleMessageConnection = g_signal_connect(
                manager,
                "script-message-received::consoleMessage",
                G_CALLBACK(Impl::HandleScriptConsoleMessage),
                this
            );
            webkit_user_content_manager_register_script_message_handler(manager, "consoleMessage");

            {
                WebKitUserScript* preloadUserScript = webkit_user_script_new(
                    preloadScript.c_str(),
                    WEBKIT_USER_CONTENT_INJECT_TOP_FRAME,
                    WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_START,
                    nullptr, nullptr
                );
                webkit_user_content_manager_add_script(manager, preloadUserScript);
                webkit_user_script_unref(preloadUserScript);
            }
        }

        gtk_widget_show(GTK_WIDGET(impl_->gtkWebView));

        g_signal_connect(impl_->gtkWebView, "context-menu", G_CALLBACK(HandleContextMenu), nullptr);

        impl_->loadChangedConnection = g_signal_connect(
            impl_->gtkWebView, "load-changed", 
            G_CALLBACK(Impl::HandleLoadChanged), this
        );
        impl_->loadFailedConnection = g_signal_connect(
            impl_->gtkWebView, "load-failed",
            G_CALLBACK(Impl::HandleLoadFailed), this
        );
        impl_->decidePolicyConnection = g_signal_connect(
            impl_->gtkWebView, "decide-policy",
            G_CALLBACK(Impl::HandleDecidePolicy), this
        );
        impl_->webProcessTerminatedConnection = g_signal_connect(
            impl_->gtkWebView, "web-process-terminated",
            G_CALLBACK(Impl::HandleWebProcessTerminated), this
        );
        impl_->buttonPressEventConnection = g_signal_connect(
            impl_->gtkWebView, "button-press-event",
            G_CALLBACK(Impl::HandleButtonPressEvent), this
        );
        impl_->buttonReleaseEventConnection = g_signal_connect(
            impl_->gtkWebView, "button-release-event",
            G_CALLBACK(Impl::HandleButtonReleaseEvent), this
        );
        impl_->titleChangedConnection = g_signal_connect(
            impl_->gtkWebView, "notify::title",
            G_CALLBACK(Impl::HandleTitleChanged), this
        );
        impl_->dragDataReceivedConnection = g_signal_connect(
            impl_->gtkWebView, "drag-data-received",
            G_CALLBACK(Impl::HandleDragDataReceived), this
        );
    }

    void WebView::Impl::HandleTitleChanged(GObject*, GParamSpec*, WebView* webView) {
        const char* title = webkit_web_view_get_title(webView->impl_->gtkWebView);
        webView->impl_->callbacks.onPageTitleUpdated(
            title == nullptr ? "" : title
        );
    }

    void WebView::Impl::HandleDragDataReceived(GtkWidget*, GdkDragContext*, gint, gint, GtkSelectionData* selectionData, guint, guint, WebView* webView) {
        gchar** uris = gtk_selection_data_get_uris(selectionData);
        if (uris == nullptr) return;

        std::vector<std::string> paths;
        for (gchar** uri = uris; *uri != nullptr; ++uri) {
            gchar* path = g_filename_from_uri(*uri, nullptr, nullptr);
            if (path != nullptr) {
                paths.emplace_back(path);
                g_free(path);
            }
        }
        g_strfreev(uris);

        if (!paths.empty()) {
            webView->impl_->callbacks.onFilesDropped(std::move(paths));
        }
    }

    void WebView::Impl::HandleScriptWindowDrag(WebKitUserContentManager*, WebKitJavascriptResult*, WebView* webView) {
        std::optional<GdkEventButton>& lastLeftMouseDownEvent = webView->impl_->lastLeftMouseDownEvent;
        if (!lastLeftMouseDownEvent.has_value()) return;

        GtkWidget* window = gtk_widget_get_toplevel(GTK_WIDGET(webView->impl_->gtkWebView));
        if (!GTK_IS_WINDOW(window)) return;

        gtk_window_begin_move_drag(GTK_WINDOW(window),
            lastLeftMouseDownEvent->button,
            lastLeftMouseDownEvent->x_root, lastLeftMouseDownEvent->y_root,
            lastLeftMouseDownEvent->time
        );
        lastLeftMouseDownEvent.reset();
    }
    void WebView::Impl::HandleScriptConsoleMessage(WebKitUserContentManager*, WebKitJavascriptResult* jsResult, WebView* webView) {
        std::optional<std::string> payload = jsResultToString(jsResult);
        if (!payload.has_value() || payload->empty()) return;
        const char* level = (*payload)[0] == 'd' ? "debug"
            : (*payload)[0] == 'w' ? "warning"
            : (*payload)[0] == 'e' ? "error" : "info";
        webView->impl_->callbacks.onConsoleMessage(level, payload->substr(1));
    }
    gboolean WebView::Impl::HandleButtonPressEvent(GtkWidget*, GdkEventButton* event, WebView* webView) {
        if (event->button == 1 && event->type == GDK_BUTTON_PRESS) {
            webView->impl_->lastLeftMouseDownEvent.emplace(*event);
        }
        return FALSE;
    }
    gboolean WebView::Impl::HandleButtonReleaseEvent(GtkWidget*, GdkEventButton* event, WebView* webView) {
        if (event->button == 1 && event->type == GDK_BUTTON_RELEASE) {
            webView->impl_->lastLeftMouseDownEvent.reset();
        }
        return FALSE;
    }

    WebView::~WebView() {
        for (const auto& [requestId, request] : impl_->pendingProtocolRequests) {
            impl_->callbacks.onCustomProtocolRequestCancelled(requestId);
            GError* error = g_error_new(WEBKIT_NETWORK_ERROR, 1, "DeskGap webview destroyed");
            webkit_uri_scheme_request_finish_error(request, error);
            g_error_free(error);
            g_object_unref(request);
        }
        impl_->pendingProtocolRequests.clear();
        for (gulong connection: { 
            impl_->loadChangedConnection,
            impl_->loadFailedConnection,
            impl_->decidePolicyConnection,
            impl_->webProcessTerminatedConnection,
            impl_->buttonPressEventConnection,
            impl_->buttonReleaseEventConnection,
            impl_->titleChangedConnection,
            impl_->dragDataReceivedConnection
        }) {
            g_signal_handler_disconnect(impl_->gtkWebView, connection);
        }

        for (const auto& [requestId, decision]: impl_->pendingNavigationPolicies) {
            webkit_policy_decision_ignore(decision);
            g_object_unref(decision);
        }
        impl_->pendingNavigationPolicies.clear();

        WebKitUserContentManager* manager = webkit_web_view_get_user_content_manager(impl_->gtkWebView);
        for (gulong connection: {
            impl_->scriptWindowDragConnection,
            impl_->scriptConsoleMessageConnection
        }) {
            g_signal_handler_disconnect(manager, connection);
        }
        for (const char* handlerName: { "windowDrag", "consoleMessage" }) {
            webkit_user_content_manager_unregister_script_message_handler(manager, handlerName);
        }

        g_object_unref(impl_->gtkWebView);
    }

    void WebView::LoadLocalFile(const std::string& path, const std::string& fragment, const std::string& applicationHost) {
        const char* cpath = path.c_str();
        gchar* folderPath = g_path_get_dirname(cpath);
        gchar* filename = g_path_get_basename(cpath);
        gchar* encodedFilename = g_uri_escape_string(filename, nullptr, false);
        gchar* url = g_strdup_printf("%s://%s/%s#%s", localURLScheme, applicationHost.c_str(), encodedFilename, fragment.c_str());

        impl_->servedPath.emplace(folderPath);
        impl_->allowedNavigationUrl = url;
        webkit_web_view_load_uri(impl_->gtkWebView, url);

        g_free(folderPath);
        g_free(filename);
        g_free(encodedFilename);
        g_free(url);
    }

    void WebView::LoadRequest(
        const std::string& method,
        const std::string& urlString,
        const std::vector<HTTPHeader>& headers,
        const std::optional<std::string>& body
    ) {
        impl_->servedPath.reset();
        impl_->allowedNavigationUrl = urlString;

        WebKitURIRequest* request = webkit_uri_request_new(urlString.c_str());

        SoupMessageHeaders* requestHeaders = webkit_uri_request_get_http_headers(request);

        for (const HTTPHeader& header: headers) {
            soup_message_headers_append(requestHeaders, header.field.c_str(), header.value.c_str());
        }

        webkit_web_view_load_request(impl_->gtkWebView, request);
        g_object_unref(request);
    }

    void WebView::SetDevToolsEnabled(bool enabled) {
        WebKitSettings* settings = webkit_web_view_get_settings(impl_->gtkWebView);
        webkit_settings_set_enable_developer_extras(settings, enabled);
    }

    void WebView::Reload() {
        const char* uri = webkit_web_view_get_uri(impl_->gtkWebView);
        if (uri != nullptr) impl_->allowedNavigationUrl = uri;
        webkit_web_view_reload_bypass_cache(impl_->gtkWebView);
    }

    void WebView::ResolveNavigationPolicy(uint64_t requestId, bool allow) {
        impl_->ResolveNavigationPolicy(requestId, allow);
    }

    void WebView::ResolveCustomProtocolRequest(
        uint64_t requestId,
        int statusCode,
        const std::string& statusText,
        const std::vector<HTTPHeader>& headers,
        std::vector<uint8_t>&& body
    ) {
        impl_->ResolveCustomProtocolRequest(
            requestId, statusCode, statusText, headers, std::move(body)
        );
    }

    void WebView::ExecuteJavaScript(const std::string& scriptString, std::optional<JavaScriptExecutionCallback>&& optionalCallback) {
        if (!optionalCallback.has_value()) {
            webkit_web_view_run_javascript(impl_->gtkWebView, scriptString.c_str(), nullptr, nullptr, nullptr);
        }
        else {
            webkit_web_view_run_javascript(
                impl_->gtkWebView, scriptString.c_str(), nullptr,
                [](GObject* object, GAsyncResult* asyncResult, gpointer user_data) {
                    JavaScriptExecutionCallback* callbackPtr = static_cast<JavaScriptExecutionCallback*>(user_data);
                    JavaScriptExecutionCallback callback(std::move(*callbackPtr));
                    delete callbackPtr;

                    WebKitJavascriptResult *jsResult;
                    GError *error = NULL;

                    jsResult = webkit_web_view_run_javascript_finish(WEBKIT_WEB_VIEW(object), asyncResult, &error);
                    if (jsResult == nullptr) {
                        callback(std::make_optional<std::string>(error->message));
                        g_error_free (error);
                        return;
                    }

                    callback(std::nullopt);

                    webkit_javascript_result_unref(jsResult);
                },
                new JavaScriptExecutionCallback(std::move(*optionalCallback))
            );
        };
    }
}
