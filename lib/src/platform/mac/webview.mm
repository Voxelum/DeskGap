#import <Cocoa/Cocoa.h>
#include <functional>
#include <memory>
#include <string>

#import "./cocoa/DeskGapWindow.h"
#import "./cocoa/DeskGapLocalURLSchemeHandler.h"
#include "webview.hpp"
#include "webview_impl.h"
#include "./util/string_convert.h"

extern "C" {
    extern char BIN2CODE_DG_PRELOAD_MAC_JS_CONTENT[];
    extern int BIN2CODE_DG_PRELOAD_MAC_JS_SIZE;
}
namespace {
    NSString* const DevToolsAlertSuppressionKey = @"DeskGap.Suppressions.DevToolsAlert";
    NSArray<NSString*>* const ObservedWKWebViewKeyPaths = @[ @"title" ];
    NSString* const WindowDragHandlerName = @"windowDrag";
    NSString* const ConsoleMessageHandlerName = @"consoleMessage";
    NSString* const localURLScheme = @"deskgap-local";
}

@interface DeskGapCustomURLSchemeHandler: NSObject <WKURLSchemeHandler>
-(instancetype)initWithStart:(std::function<void(id<WKURLSchemeTask>)>)start
                         stop:(std::function<void(id<WKURLSchemeTask>)>)stop;
@end

@implementation DeskGapCustomURLSchemeHandler {
    std::function<void(id<WKURLSchemeTask>)> start_;
    std::function<void(id<WKURLSchemeTask>)> stop_;
}
-(instancetype)initWithStart:(std::function<void(id<WKURLSchemeTask>)>)start
                         stop:(std::function<void(id<WKURLSchemeTask>)>)stop {
    self = [super init];
    if (self) {
        start_ = std::move(start);
        stop_ = std::move(stop);
    }
    return self;
}
-(void)webView:(WKWebView*)webView startURLSchemeTask:(id<WKURLSchemeTask>)task {
    start_(task);
}
-(void)webView:(WKWebView*)webView stopURLSchemeTask:(id<WKURLSchemeTask>)task {
    stop_(task);
}
@end

@interface DeskGapWebView: WKWebView
-(void)deskgap_setFilesDroppedCallback: (std::function<void(std::vector<std::string>&&)>)callback;
@end
@implementation DeskGapWebView
{
    std::function<void(std::vector<std::string>&&)> filesDroppedCallback_;
}

-(void)deskgap_setFilesDroppedCallback: (std::function<void(std::vector<std::string>&&)>)callback {
    filesDroppedCallback_ = std::move(callback);
}

-(BOOL)performDragOperation:(id<NSDraggingInfo>)sender {
    NSArray<NSURL*>* URLs = [[sender draggingPasteboard]
        readObjectsForClasses:@[[NSURL class]]
        options:@{NSPasteboardURLReadingFileURLsOnlyKey: @YES}
    ];
    std::vector<std::string> paths;
    paths.reserve(URLs.count);
    for (NSURL* URL in URLs) {
        if (URL.isFileURL) {
            paths.emplace_back(URL.fileSystemRepresentation);
        }
    }
    if (!paths.empty()) {
        filesDroppedCallback_(std::move(paths));
    }
    return [super performDragOperation:sender];
}

- (void)deskgap_toggleDevTools: (id)sender {
    BOOL isDevToolsEnabled = ![[self.configuration.preferences valueForKey: @"developerExtrasEnabled"] boolValue];
    [self.configuration.preferences setValue:@(isDevToolsEnabled) forKey:@"developerExtrasEnabled"];

    if (isDevToolsEnabled) {
        if (!self.window) return;
        NSUserDefaults *defaults = [NSUserDefaults standardUserDefaults];
        if ([defaults boolForKey: DevToolsAlertSuppressionKey]) {
            return;
        }

        NSAlert* alert = [[NSAlert alloc] init];
        [alert setMessageText: @"Developer Tools Enabled"];
        [alert setInformativeText: @"Right click the page and select “Inspect Element” To show the tools."];
        [alert setShowsSuppressionButton: YES];
        
        [alert beginSheetModalForWindow: self.window completionHandler: ^(NSModalResponse) {
            if (alert.suppressionButton.state == NSControlStateValueOn) {
                [defaults setBool: YES forKey: DevToolsAlertSuppressionKey];
            }
        }];
    }
}

- (BOOL)validateMenuItem:(NSMenuItem*)item {
    if (item.action == @selector(deskgap_toggleDevTools:)) {
        BOOL isDevToolsEnabled = [[self.configuration.preferences valueForKey: @"developerExtrasEnabled"] boolValue];
        [item setTitle: isDevToolsEnabled? @"Disable Developer Tools": @"Enable Developer Tools"];
    }
    return YES;
}

- (void)willOpenMenu:(NSMenu *)menu withEvent:(NSEvent *)event {
    static NSArray<NSString*>* identifiersToBeDeleted = @[
        @"WKMenuItemIdentifierGoBack",
        @"WKMenuItemIdentifierGoForward",
        @"WKMenuItemIdentifierReload"
    ];
    for (NSInteger i = 0; i < menu.numberOfItems; ++i) {
        NSMenuItem* item = [menu itemAtIndex: i];
        if ([identifiersToBeDeleted containsObject: item.identifier]) {
            [item setHidden: YES];
        }
        
    }
    [super willOpenMenu: menu withEvent: event];
}

@end


@interface DeskGapWebViewDelegate: NSObject <WKNavigationDelegate, WKScriptMessageHandler, WKUIDelegate>
-(instancetype)initWithCallbacks: (DeskGap::WebView::EventCallbacks&) callbacks;
-(void)allowNextNavigationURL:(NSString*)url;
-(void)resolveNavigationPolicy:(uint64_t)requestId allow:(BOOL)allow;
-(void)cancelPendingNavigationPolicies;
@end

@implementation DeskGapWebViewDelegate {
    DeskGap::WebView::EventCallbacks callbacks_;
    NSMutableDictionary<NSNumber*, id>* pendingNavigationPolicies_;
    NSString* allowedNavigationURL_;
    uint64_t nextPolicyRequestId_;
}
-(instancetype)initWithCallbacks: (DeskGap::WebView::EventCallbacks&) callbacks {
    self = [super init];
    if (self) {
        callbacks_ = std::move(callbacks);
        pendingNavigationPolicies_ = [NSMutableDictionary new];
        nextPolicyRequestId_ = 1;
    }
    return self;
}

-(void)allowNextNavigationURL:(NSString*)url {
    allowedNavigationURL_ = [url copy];
}

-(void)resolveNavigationPolicy:(uint64_t)requestId allow:(BOOL)allow {
    NSNumber* key = @(requestId);
    void (^handler)(WKNavigationActionPolicy) = pendingNavigationPolicies_[key];
    if (handler == nil) return;
    [pendingNavigationPolicies_ removeObjectForKey:key];
    handler(allow ? WKNavigationActionPolicyAllow : WKNavigationActionPolicyCancel);
}

-(void)cancelPendingNavigationPolicies {
    for (NSNumber* key in pendingNavigationPolicies_) {
        void (^handler)(WKNavigationActionPolicy) = pendingNavigationPolicies_[key];
        handler(WKNavigationActionPolicyCancel);
    }
    [pendingNavigationPolicies_ removeAllObjects];
}

- (void)webView:(WKWebView *)webView
    decidePolicyForNavigationAction:(WKNavigationAction *)navigationAction
    decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
    if (navigationAction.targetFrame == nil || !navigationAction.targetFrame.mainFrame) {
        decisionHandler(WKNavigationActionPolicyAllow);
        return;
    }
    NSString* url = navigationAction.request.URL.absoluteString ?: @"";
    if (allowedNavigationURL_ != nil && [allowedNavigationURL_ isEqualToString:url]) {
        allowedNavigationURL_ = nil;
        decisionHandler(WKNavigationActionPolicyAllow);
        return;
    }
    uint64_t requestId = nextPolicyRequestId_++;
    pendingNavigationPolicies_[@(requestId)] = [decisionHandler copy];
    callbacks_.onNavigationPolicyRequest(requestId, CXXStr(url), false);
}

- (WKWebView *)webView:(WKWebView *)webView
    createWebViewWithConfiguration:(WKWebViewConfiguration *)configuration
    forNavigationAction:(WKNavigationAction *)navigationAction
    windowFeatures:(WKWindowFeatures *)windowFeatures {
    NSMutableArray<NSString*>* features = [NSMutableArray new];
    if (windowFeatures.width != nil) [features addObject:[NSString stringWithFormat:@"width=%@", windowFeatures.width]];
    if (windowFeatures.height != nil) [features addObject:[NSString stringWithFormat:@"height=%@", windowFeatures.height]];
    callbacks_.onNewWindowRequested(
        CXXStr(navigationAction.request.URL.absoluteString ?: @""),
        "",
        CXXStr([features componentsJoinedByString:@","])
    );
    return nil;
}

- (void)webView:(WKWebView *)webView didFailNavigation:(WKNavigation *)navigation withError:(NSError *)error {
    NSString* failingURL = error.userInfo[NSURLErrorFailingURLStringErrorKey];
    callbacks_.didFailLoad((int)error.code, CXXStr(error.localizedDescription), failingURL == nil ? "" : CXXStr(failingURL));
}

- (void)webViewWebContentProcessDidTerminate:(WKWebView *)webView {
    callbacks_.onRenderProcessGone("crashed", -1);
}

- (void)webView:(WKWebView *)webView didStartProvisionalNavigation:(WKNavigation *)navigation {
    NSString* url = webView.URL.absoluteString;
    callbacks_.didStartNavigation(url == nil ? "" : CXXStr(url), false);
}

- (void)webView:(WKWebView *)webView didReceiveServerRedirectForProvisionalNavigation:(WKNavigation *)navigation {
    NSString* url = webView.URL.absoluteString;
    callbacks_.didStartNavigation(url == nil ? "" : CXXStr(url), true);
}

- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
    callbacks_.didFinishLoad();
}

- (void)webView:(WKWebView *)webView didFailProvisionalNavigation:(WKNavigation *)navigation withError:(NSError *)error {
    NSString* failingURL = error.userInfo[NSURLErrorFailingURLStringErrorKey];
    callbacks_.didFailLoad((int)error.code, CXXStr(error.localizedDescription), failingURL == nil ? "" : CXXStr(failingURL));
}

- (void)userContentController:(WKUserContentController *) userContentController didReceiveScriptMessage:(WKScriptMessage *)message {
    if ([message.name isEqualToString: WindowDragHandlerName]) {
        NSWindow* window = message.webView.window;
        if (window) {
            [(DeskGapWindow*)window deskgap_startDragging];
        }
    }
    else if ([message.name isEqualToString: ConsoleMessageHandlerName] && [message.body isKindOfClass:[NSString class]]) {
        NSString* payload = message.body;
        if (payload.length > 0) {
            unichar code = [payload characterAtIndex:0];
            const char* level = code == 'd' ? "debug" : code == 'w' ? "warning" : code == 'e' ? "error" : "info";
            callbacks_.onConsoleMessage(level, CXXStr([payload substringFromIndex:1]));
        }
    }
}

- (void)observeValueForKeyPath:(NSString *)keyPath ofObject:(id)object change:(NSDictionary<NSKeyValueChangeKey, id> *)change context:(void *)context {
    if ([keyPath isEqualToString: @"title"]) {
        id value = change[NSKeyValueChangeNewKey];
        NSString* title = [value isKindOfClass:[NSString class]] ? value : @"";
        callbacks_.onPageTitleUpdated(CXXStr(title));
    }
}

- (void)webView:(WKWebView *)webView
    runOpenPanelWithParameters:(WKOpenPanelParameters *)parameters
    initiatedByFrame:(WKFrameInfo *)frame
    completionHandler:(void (^)(NSArray<NSURL *> *URLs))completionHandler
    API_AVAILABLE(macosx(10.12))
{
    NSOpenPanel* openPanel = [NSOpenPanel openPanel];
    [openPanel setAllowsMultipleSelection: parameters.allowsMultipleSelection];
    if (@available(macOS 10.13.4, *)) {
        [openPanel setCanChooseDirectories: parameters.allowsDirectories];
    }

    [openPanel beginSheetModalForWindow: [webView window] completionHandler: ^(NSModalResponse result) {
        if (result == NSModalResponseOK) {
            completionHandler([openPanel URLs]);
        }
        else {
            completionHandler(nil);
        }
    }];
}

@end


namespace DeskGap {
    namespace {
        WKWebsiteDataStore* DataStoreForSession(const WebView::SessionOptions& session) {
            if (session.kind != "ephemeral") return [WKWebsiteDataStore defaultDataStore];
            static NSMutableDictionary<NSString*, WKWebsiteDataStore*>* stores = [NSMutableDictionary new];
            NSString* key = NSStr(session.id);
            @synchronized (stores) {
                WKWebsiteDataStore* store = stores[key];
                if (store == nil) {
                    store = [WKWebsiteDataStore nonPersistentDataStore];
                    stores[key] = store;
                }
                return store;
            }
        }
    }

    void WebView::Impl::ServePath(NSString* path) {
        if (@available(macOS 10.13, *)) {
            [(DeskGapLocalURLSchemeHandler*)localURLSchemeHandler servePath: path];
        }
    }

    void WebView::Impl::StartCustomProtocolRequest(id<WKURLSchemeTask> task) {
        uint64_t requestId = nextProtocolRequestId++;
        pendingProtocolRequests[@(requestId)] = task;
        std::vector<WebView::HTTPHeader> headers;
        NSDictionary<NSString*, NSString*>* requestHeaders = task.request.allHTTPHeaderFields;
        headers.reserve(requestHeaders.count);
        for (NSString* name in requestHeaders) {
            headers.push_back({ CXXStr(name), CXXStr(requestHeaders[name]) });
        }
        callbacks.onCustomProtocolRequest(
            requestId,
            CXXStr(task.request.HTTPMethod ?: @"GET"),
            CXXStr(task.request.URL.absoluteString),
            std::move(headers)
        );
    }

    void WebView::Impl::StopCustomProtocolRequest(id<WKURLSchemeTask> task) {
        NSNumber* matchingRequestId = nil;
        for (NSNumber* requestId in pendingProtocolRequests) {
            if (pendingProtocolRequests[requestId] == task) {
                matchingRequestId = requestId;
                break;
            }
        }
        if (matchingRequestId == nil) return;
        [pendingProtocolRequests removeObjectForKey:matchingRequestId];
        callbacks.onCustomProtocolRequestCancelled(matchingRequestId.unsignedLongLongValue);
    }

    void WebView::Impl::ResolveCustomProtocolRequest(
        uint64_t requestId,
        int statusCode,
        const std::string&,
        const std::vector<WebView::HTTPHeader>& headers,
        std::vector<uint8_t>&& body
    ) {
        id<WKURLSchemeTask> task = pendingProtocolRequests[@(requestId)];
        if (task == nil) return;
        [pendingProtocolRequests removeObjectForKey:@(requestId)];
        NSMutableDictionary<NSString*, NSString*>* responseHeaders = [NSMutableDictionary new];
        for (const auto& header : headers) {
            responseHeaders[NSStr(header.field)] = NSStr(header.value);
        }
        [task didReceiveResponse:[[NSHTTPURLResponse alloc]
            initWithURL:task.request.URL
            statusCode:statusCode
            HTTPVersion:@"HTTP/1.1"
            headerFields:responseHeaders
        ]];
        if (!body.empty()) {
            [task didReceiveData:[NSData dataWithBytes:body.data() length:body.size()]];
        }
        [task didFinish];
    }

    WebView::WebView(
        EventCallbacks&& callbacks,
        const std::string& preloadScriptString,
        SessionOptions&& session
    ): impl_(std::make_unique<Impl>()) {
        std::string preloadScript = std::string(BIN2CODE_DG_PRELOAD_MAC_JS_CONTENT, BIN2CODE_DG_PRELOAD_MAC_JS_SIZE) + preloadScriptString;
        impl_->callbacks = callbacks;
        impl_->pendingProtocolRequests = [NSMutableDictionary new];
        auto onFilesDropped = callbacks.onFilesDropped;
        DeskGapWebViewDelegate* webviewDelegate = [[DeskGapWebViewDelegate alloc] initWithCallbacks: callbacks];

        WKWebViewConfiguration* configuration = [[WKWebViewConfiguration alloc] init];
        configuration.websiteDataStore = DataStoreForSession(session);


        if (@available(macOS 10.13, *)) {
            //WKURLSchemeHandlers enables web workers and ajax requesting local files in 10.13+
            DeskGapLocalURLSchemeHandler* handler = [DeskGapLocalURLSchemeHandler new];
            impl_->localURLSchemeHandler = handler;
            [configuration setURLSchemeHandler: handler forURLScheme: localURLScheme];
            impl_->customURLSchemeHandlers = [NSMutableArray new];
            for (const auto& scheme : session.customSchemes) {
                WebView::Impl* protocolImpl = impl_.get();
                DeskGapCustomURLSchemeHandler* customHandler = [[DeskGapCustomURLSchemeHandler alloc]
                    initWithStart:[protocolImpl](id<WKURLSchemeTask> task) {
                        protocolImpl->StartCustomProtocolRequest(task);
                    }
                    stop:[protocolImpl](id<WKURLSchemeTask> task) {
                        protocolImpl->StopCustomProtocolRequest(task);
                    }
                ];
                [impl_->customURLSchemeHandlers addObject:customHandler];
                [configuration setURLSchemeHandler:customHandler forURLScheme:NSStr(scheme.name)];
            }
        }

        [configuration.preferences setValue:@YES forKey:@"allowFileAccessFromFileURLs"];

        for (NSString* handlerName in @[WindowDragHandlerName, ConsoleMessageHandlerName]) {
            [configuration.userContentController
                addScriptMessageHandler: webviewDelegate
                name: handlerName
            ];
        }
        
        [configuration.userContentController
            addUserScript: [[WKUserScript alloc]
                initWithSource: NSStr(preloadScript)
                injectionTime: WKUserScriptInjectionTimeAtDocumentStart
                forMainFrameOnly: YES
            ]
        ];

        WKWebView* wkWebView = [[DeskGapWebView alloc] initWithFrame: CGRectZero configuration: configuration];
        if (session.userAgent.has_value()) {
            wkWebView.customUserAgent = NSStr(*session.userAgent);
        }
        [(DeskGapWebView*)wkWebView deskgap_setFilesDroppedCallback: std::move(onFilesDropped)];

        if (@available(macOS 10.12, *)) {
            [wkWebView setValue: @NO forKey:@"drawsBackground"];
        }
        else {
            [wkWebView setValue: @YES forKey:@"drawsTransparentBackground"];
        }

        [wkWebView setNavigationDelegate: webviewDelegate];
        [wkWebView setUIDelegate: webviewDelegate];

        for (NSString* keyPath in ObservedWKWebViewKeyPaths) {
            [wkWebView addObserver: webviewDelegate forKeyPath: keyPath options: NSKeyValueObservingOptionNew context: nil];
        }

        impl_->wkWebView = wkWebView;
        impl_->webViewDelegate = webviewDelegate;
    }

    void WebView::LoadLocalFile(const std::string& path, const std::string& fragment, const std::string& applicationHost) {
        impl_->ServePath(nil);
        if (@available(macOS 10.13, *)) {
            NSString* cocoaPath = NSStr(path);
            NSString* folder = [cocoaPath stringByDeletingLastPathComponent];
            impl_->ServePath(folder);

            NSString* filename = [cocoaPath lastPathComponent];
            NSString* encodedFilename = [filename stringByAddingPercentEncodingWithAllowedCharacters: [NSCharacterSet URLPathAllowedCharacterSet]];

            NSURL* localFileRequestURL = [NSURL URLWithString: [NSString stringWithFormat: @"%@://%@/%@#%@", localURLScheme, NSStr(applicationHost), encodedFilename, NSStr(fragment)]];
            [(DeskGapWebViewDelegate*)impl_->webViewDelegate allowNextNavigationURL:localFileRequestURL.absoluteString];
            [impl_->wkWebView loadRequest:[NSURLRequest requestWithURL: localFileRequestURL]];
        }
        else {
            static NSURL* rootURL = [NSURL fileURLWithPath: @"/"];
            NSURL* fileURL = [NSURL URLWithString: [NSString stringWithFormat: @"%@#%@", [NSURL fileURLWithPath: NSStr(path)].absoluteString, NSStr(fragment)]];
            [(DeskGapWebViewDelegate*)impl_->webViewDelegate allowNextNavigationURL:fileURL.absoluteString];
            [impl_->wkWebView
                loadFileURL: fileURL
                allowingReadAccessToURL: rootURL
            ];
        }
    }

    void WebView::LoadRequest(
        const std::string& method,
        const std::string& urlString,
        const std::vector<HTTPHeader>& headers,
        const std::optional<std::string>& body
    ) {
        impl_->ServePath(nil);
        NSString* urlNSString = NSStr(urlString);
        NSURL* url = [NSURL URLWithString: urlNSString];
        if (!url) {
            @throw [NSException
                exceptionWithName: NSInvalidArgumentException
                reason: [NSString stringWithFormat: @"The URL string was malformed: %@", urlNSString]
                userInfo: nil
            ];
        }
        NSMutableURLRequest* request = [NSMutableURLRequest requestWithURL: url];
        [(DeskGapWebViewDelegate*)impl_->webViewDelegate allowNextNavigationURL:url.absoluteString];
        [request setHTTPMethod: NSStr(method)];
        if (body.has_value()) {
            [request setHTTPBody: [NSData dataWithBytes: body->data() length: body->size()]];
        }
        for (const HTTPHeader& header: headers) {
            [request
                addValue: NSStr(header.value)
                forHTTPHeaderField: NSStr(header.field)
            ];
        }
        [impl_->wkWebView loadRequest: request];
    }

    void WebView::Reload() {
        [(DeskGapWebViewDelegate*)impl_->webViewDelegate allowNextNavigationURL:impl_->wkWebView.URL.absoluteString];
        [impl_->wkWebView reloadFromOrigin];
    }

    void WebView::ResolveNavigationPolicy(uint64_t requestId, bool allow) {
        [(DeskGapWebViewDelegate*)impl_->webViewDelegate resolveNavigationPolicy:requestId allow:allow];
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
        void (^scriptCompletionHandler)(id, NSError *error) = nil;
        if (optionalCallback.has_value()) {
            JavaScriptExecutionCallback callback = std::move(*optionalCallback);
            scriptCompletionHandler = ^(id result, NSError *error) {
                if (error) {
                    NSString* errorString = nil;
                    NSMutableDictionary* errorUserInfo = [[error userInfo] mutableCopy];
                    if (errorUserInfo) {
                        NSURL* sourceURL = [errorUserInfo valueForKey: @"WKJavaScriptExceptionSourceURL"];
                        if (sourceURL) {
                            errorUserInfo[@"WKJavaScriptExceptionSourceURL"] = [sourceURL absoluteString];
                        }
                        NSData* errorInfoJSONData = nil;
                        @try {
                            errorInfoJSONData = [NSJSONSerialization dataWithJSONObject: errorUserInfo options: kNilOptions error: nil];
                        }
                        @catch (NSException *exception) { }
                        errorString = [[NSString alloc] initWithData: errorInfoJSONData encoding: NSUTF8StringEncoding];
                    }
                    
                    if (!errorString) {
                        errorString = [error localizedDescription];
                    }
                    
                    callback(std::make_optional<std::string>([errorString UTF8String]));
                }
                else {
                    callback(std::nullopt);
                }
            };
        }


        [impl_->wkWebView 
            evaluateJavaScript: NSStr(scriptString)
            completionHandler: scriptCompletionHandler
        ];
    }


    void WebView::SetDevToolsEnabled(bool enabled) {
        [impl_->wkWebView.configuration.preferences setValue:@(enabled) forKey:@"developerExtrasEnabled"];
    }
    WebView::~WebView() = default;

    WebView::Impl::~Impl() {
        for (NSNumber* requestId in pendingProtocolRequests) {
            callbacks.onCustomProtocolRequestCancelled(requestId.unsignedLongLongValue);
        }
        [pendingProtocolRequests removeAllObjects];
        [(DeskGapWebViewDelegate*)webViewDelegate cancelPendingNavigationPolicies];
        [wkWebView setNavigationDelegate:nil];
        [wkWebView setUIDelegate:nil];
        for (NSString* handlerName in @[WindowDragHandlerName, ConsoleMessageHandlerName]) {
            [wkWebView.configuration.userContentController removeScriptMessageHandlerForName:handlerName];
        }
        for (NSString* keyPath in ObservedWKWebViewKeyPaths) {
            [wkWebView removeObserver: webViewDelegate forKeyPath: keyPath];
        }
    }
}
