#ifndef gtk_webview_impl_h
#define gtk_webview_impl_h

#include <optional>
#include <unordered_map>
#include <webkit2/webkit2.h>

#include "webview.hpp"

namespace DeskGap {
    struct WebView::Impl {
		WebKitWebView* gtkWebView;
		WebView::EventCallbacks callbacks;
		std::optional<std::string> servedPath;
		uint64_t nextProtocolRequestId = 1;
		std::unordered_map<uint64_t, WebKitURISchemeRequest*> pendingProtocolRequests;

		static void HandleLocalFileUriSchemeRequest(WebKitURISchemeRequest *request, gpointer);
		static void HandleCustomUriSchemeRequest(WebKitURISchemeRequest *request, gpointer);
		void ResolveCustomProtocolRequest(
			uint64_t requestId,
			int statusCode,
			const std::string& statusText,
			const std::vector<HTTPHeader>& headers,
			std::vector<uint8_t>&& body
		);
		
		gulong loadChangedConnection;
		static void HandleLoadChanged(GtkWidget*, WebKitLoadEvent, WebView*);

		gulong loadFailedConnection;
		static gboolean HandleLoadFailed(WebKitWebView*, WebKitLoadEvent, const gchar*, GError*, WebView*);

		gulong decidePolicyConnection;
		static gboolean HandleDecidePolicy(WebKitWebView*, WebKitPolicyDecision*, WebKitPolicyDecisionType, WebView*);
		uint64_t nextPolicyRequestId = 1;
		std::optional<std::string> allowedNavigationUrl;
		std::unordered_map<uint64_t, WebKitPolicyDecision*> pendingNavigationPolicies;
		void ResolveNavigationPolicy(uint64_t requestId, bool allow);

		gulong webProcessTerminatedConnection;
		static void HandleWebProcessTerminated(WebKitWebView*, WebKitWebProcessTerminationReason, WebView*);

		gulong buttonPressEventConnection;
		static gboolean HandleButtonPressEvent(GtkWidget*, GdkEventButton*, WebView*);

		gulong buttonReleaseEventConnection;
		static gboolean HandleButtonReleaseEvent(GtkWidget*, GdkEventButton*, WebView*);

		std::optional<GdkEventButton> lastLeftMouseDownEvent;

		gulong scriptWindowDragConnection;
		static void HandleScriptWindowDrag(WebKitUserContentManager*, WebKitJavascriptResult*, WebView*);

		gulong scriptConsoleMessageConnection;
		static void HandleScriptConsoleMessage(WebKitUserContentManager*, WebKitJavascriptResult*, WebView*);
		
		gulong titleChangedConnection;
		static void HandleTitleChanged(GObject*, GParamSpec* pspec, WebView*);

		gulong dragDataReceivedConnection;
		static void HandleDragDataReceived(GtkWidget*, GdkDragContext*, gint, gint, GtkSelectionData*, guint, guint, WebView*);
    };
}

#endif
