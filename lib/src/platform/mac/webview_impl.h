#ifndef DESKGAP_MAC_WEBVIEW_IMPL_H
#define DESKGAP_MAC_WEBVIEW_IMPL_H

#import <WebKit/WebKit.h>
#include "webview.hpp"

namespace DeskGap {
    struct WebView::Impl {
        WKWebView* wkWebView;
        NSObject* webViewDelegate;
        NSObject* localURLSchemeHandler;
        NSMutableArray* customURLSchemeHandlers;
        NSMutableDictionary* pendingProtocolRequests;
        EventCallbacks callbacks;
        uint64_t nextProtocolRequestId = 1;
        void ServePath(NSString* path);
        void StartCustomProtocolRequest(id<WKURLSchemeTask> task);
        void StopCustomProtocolRequest(id<WKURLSchemeTask> task);
        void ResolveCustomProtocolRequest(
            uint64_t requestId,
            int statusCode,
            const std::string& statusText,
            const std::vector<HTTPHeader>& headers,
            std::vector<uint8_t>&& body
        );
        ~Impl();
    };
}

#endif
