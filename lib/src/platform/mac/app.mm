#import <Foundation/NSBundle.h>
#import <AppKit/NSApplication.h>

#include <functional>
#include <memory>
#include <cstdlib>
#include <unordered_map>
#include <mutex>
#include <unistd.h>
#import <CommonCrypto/CommonDigest.h>
#import <CoreServices/CoreServices.h>

#include "app.hpp"
#include "./util/string_convert.h"
#include "menu_impl.h"

using std::shared_ptr;
using std::function;
using std::make_shared;

@interface DeskGapAppDelegate: NSObject <NSApplicationDelegate>
-(instancetype)initWithCallbacks: (DeskGap::App::EventCallbacks&) callbacks;
@end

@implementation DeskGapAppDelegate {
    DeskGap::App::EventCallbacks callbacks_;
}

-(instancetype)initWithCallbacks: (DeskGap::App::EventCallbacks&) callbacks {
    self = [super init];
    if (self) {
        callbacks_ = std::move(callbacks);
    }
    return self;
}

- (void)applicationDidFinishLaunching:(NSNotification *)aNotification {
    callbacks_.onReady();
}

- (void)applicationDidBecomeActive:(NSNotification *)notification {
    callbacks_.onActivate();
}

- (void)application:(NSApplication *)application openURLs:(NSArray<NSURL *> *)urls {
    for (NSURL* url in urls) {
        callbacks_.onOpenURL(CXXStr(url.absoluteString));
    }
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender {
    return NO;
}

- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)sender {
    callbacks_.beforeQuit();
    return NSTerminateCancel;
}
@end

namespace DeskGap {
    static DeskGapAppDelegate* appDelegate;

    namespace {
        std::mutex singletonMutex;
        CFMessagePortRef singletonPort = nullptr;
        CFRunLoopSourceRef singletonSource = nullptr;
        App::SecondInstanceEventCallback secondInstanceCallback;

        NSString* SingletonPortName() {
            // Bootstrap message ports are scoped to the login session. Also scope by
            // user and canonical executable, so unrelated apps never share a lock.
            NSString* path = [[[NSBundle mainBundle] executablePath] stringByResolvingSymlinksInPath];
            if (path == nil) return nil;
            NSData* bytes = [path dataUsingEncoding: NSUTF8StringEncoding];
            unsigned char digest[CC_SHA256_DIGEST_LENGTH];
            CC_SHA256(bytes.bytes, static_cast<CC_LONG>(bytes.length), digest);
            NSMutableString* name = [NSMutableString stringWithFormat: @"DeskGap.%u.", getuid()];
            for (unsigned char byte : digest) [name appendFormat: @"%02x", byte];
            return name;
        }

        CFDataRef ReceiveSecondInstance(CFMessagePortRef, SInt32, CFDataRef data, void*) {
            if (data == nullptr || CFDataGetLength(data) > 1024 * 1024) return nullptr;
            id payload = [NSPropertyListSerialization propertyListWithData: (__bridge NSData*)data
                options: NSPropertyListImmutable format: nullptr error: nullptr];
            if (![payload isKindOfClass: [NSArray class]] || [payload count] != 2 ||
                ![payload[0] isKindOfClass: [NSString class]] ||
                ![payload[1] isKindOfClass: [NSString class]]) return nullptr;
            App::SecondInstanceEventCallback callback;
            {
                std::lock_guard<std::mutex> guard(singletonMutex);
                callback = secondInstanceCallback;
            }
            if (callback) callback(CXXStr(payload[0]), CXXStr(payload[1]));
            return nullptr;
        }

        NSString* DeclaredProtocol(const std::string& protocol) {
            // RFC 3986 scheme syntax; reject NULs/invalid UTF-8 before passing to LS.
            if (protocol.empty() || !((protocol[0] >= 'A' && protocol[0] <= 'Z') ||
                (protocol[0] >= 'a' && protocol[0] <= 'z'))) return nil;
            for (unsigned char c : protocol) {
                if (!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
                    (c >= '0' && c <= '9') || c == '+' || c == '-' || c == '.')) return nil;
            }
            NSBundle* bundle = [NSBundle mainBundle];
            if (bundle.bundleIdentifier.length == 0 ||
                ![bundle.bundlePath.pathExtension.lowercaseString isEqualToString: @"app"]) return nil;
            NSString* scheme = NSStr(protocol).lowercaseString;
            id types = [bundle objectForInfoDictionaryKey: @"CFBundleURLTypes"];
            if (![types isKindOfClass: [NSArray class]]) return nil;
            for (id type in types) {
                if (![type isKindOfClass: [NSDictionary class]]) continue;
                id schemes = type[@"CFBundleURLSchemes"];
                if (![schemes isKindOfClass: [NSArray class]]) continue;
                for (id declared in schemes) {
                    if ([declared isKindOfClass: [NSString class]] &&
                        [scheme isEqualToString: [declared lowercaseString]]) return scheme;
                }
            }
            // Launch Services requires a packaged app declaring the scheme; do not
            // claim success for bare executables or mutate the bundle at runtime.
            return nil;
        }
    }

    bool App::RequestSingleInstanceLock(SecondInstanceEventCallback&& callback) {
        std::unique_lock<std::mutex> guard(singletonMutex);
        if (singletonPort != nullptr) return true;
        NSString* name = SingletonPortName();
        if (name == nil) return false;
        CFMessagePortContext context = {0, nullptr, nullptr, nullptr, nullptr};
        Boolean shouldFree = false;
        CFMessagePortRef port = CFMessagePortCreateLocal(kCFAllocatorDefault,
            (__bridge CFStringRef)name, ReceiveSecondInstance, &context, &shouldFree);
        if (port != nullptr) {
            CFRunLoopSourceRef source = CFMessagePortCreateRunLoopSource(kCFAllocatorDefault, port, 0);
            if (source == nullptr) {
                CFMessagePortInvalidate(port);
                CFRelease(port);
                return false;
            }
            secondInstanceCallback = std::move(callback);
            singletonPort = port;
            singletonSource = source;
            CFRunLoopAddSource(CFRunLoopGetMain(), source, kCFRunLoopCommonModes);
            return true;
        }
        // Never report ownership on IPC/registration failure. A second instance
        // best-effort notifies the owner and returns false even if delivery fails.
        guard.unlock();
        CFMessagePortRef remote = CFMessagePortCreateRemote(kCFAllocatorDefault, (__bridge CFStringRef)name);
        if (remote != nullptr) {
            // The existing Node binding consumes a space-separated command line
            // (also on Windows); preserving argument boundaries needs a new API.
            NSString* args = [[[NSProcessInfo processInfo] arguments] componentsJoinedByString: @" "];
            NSString* cwd = [[NSFileManager defaultManager] currentDirectoryPath];
            NSData* payload = [NSPropertyListSerialization dataWithPropertyList: @[args, cwd]
                format: NSPropertyListBinaryFormat_v1_0 options: 0 error: nullptr];
            if (payload != nil && payload.length <= 1024 * 1024) {
                CFMessagePortSendRequest(remote, 0, (__bridge CFDataRef)payload, 1, 0, nullptr, nullptr);
            }
            CFRelease(remote);
        }
        return false;
    }

    bool App::HasSingleInstanceLock() {
        std::lock_guard<std::mutex> guard(singletonMutex);
        return singletonPort != nullptr && CFMessagePortIsValid(singletonPort);
    }

    void App::ReleaseSingleInstanceLock() {
        std::lock_guard<std::mutex> guard(singletonMutex);
        if (singletonPort == nullptr) return;
        CFRunLoopSourceInvalidate(singletonSource);
        CFRelease(singletonSource);
        CFMessagePortInvalidate(singletonPort);
        CFRelease(singletonPort);
        singletonSource = nullptr;
        singletonPort = nullptr;
        secondInstanceCallback = {};
    }

    bool App::SetAsDefaultProtocolClient(const std::string& protocol) {
        NSString* scheme = DeclaredProtocol(protocol);
        if (scheme == nil) return false;
        OSStatus status = LSSetDefaultHandlerForURLScheme((__bridge CFStringRef)scheme,
            (__bridge CFStringRef)[NSBundle mainBundle].bundleIdentifier);
        return status == noErr && IsDefaultProtocolClient(protocol);
    }

    bool App::IsDefaultProtocolClient(const std::string& protocol) {
        NSString* scheme = DeclaredProtocol(protocol);
        if (scheme == nil) return false;
        CFStringRef handler = LSCopyDefaultHandlerForURLScheme((__bridge CFStringRef)scheme);
        if (handler == nullptr) return false;
        bool matches = [[NSBundle mainBundle].bundleIdentifier caseInsensitiveCompare:
            (__bridge NSString*)handler] == NSOrderedSame;
        CFRelease(handler);
        return matches;
    }

    void App::Init() {
        [NSApplication sharedApplication];
    }

    void App::Run(EventCallbacks&& callbacks) {
        appDelegate = [[DeskGapAppDelegate alloc] initWithCallbacks: callbacks];
        NSApp.delegate = appDelegate;
        [NSApp run];
    }
    
    void App::Exit(int exitCode) {
        std::exit(exitCode);
    }

    std::string App::GetLocale() {
        return CXXStr([[NSLocale currentLocale] localeIdentifier]);
    }

    void App::SetAppUserModelId(const std::string&) {
    }

    bool App::SetDockVisible(bool visible) {
        return [NSApp setActivationPolicy: visible
            ? NSApplicationActivationPolicyRegular
            : NSApplicationActivationPolicyAccessory];
    }

    bool App::IsDockVisible() {
        return NSApp.activationPolicy == NSApplicationActivationPolicyRegular;
    }

    std::string App::GetExecutablePath() {
        return CXXStr([[NSBundle mainBundle] executablePath]);
    }

    std::string App::GetPath(PathName name) {
        static std::unordered_map<PathName, NSSearchPathDirectory> searchPathDirectoryByName {
            { PathName::APP_DATA,  NSApplicationSupportDirectory },
            { PathName::DESKTOP, NSDesktopDirectory },
            { PathName::DOCUMENTS, NSDocumentDirectory },
            { PathName::DOWNLOADS, NSDownloadsDirectory },
            { PathName::MUSIC, NSMusicDirectory },
            { PathName::PICTURES, NSPicturesDirectory },
            { PathName::VIDEOS, NSMoviesDirectory },
            { PathName::LOCAL_APP_DATA, NSApplicationSupportDirectory },
            { PathName::CACHE, NSCachesDirectory },
        };

        if (name == PathName::TEMP) {
            return CXXStr(NSTemporaryDirectory());
        }
        else if (name == PathName::HOME) {
            return CXXStr(NSHomeDirectory());
        }

        NSSearchPathDirectory searchPathDirectory = searchPathDirectoryByName[name];

        NSURL* pathURL = [[NSFileManager defaultManager]
            URLForDirectory: searchPathDirectory
            inDomain: NSUserDomainMask
            appropriateForURL: nil
            create: YES
            error: nil
        ];

        return CXXStr([pathURL path]);
    }

    std::string App::GetResourcePath(const char* argv0) {
        return std::string(NSBundle.mainBundle.resourcePath.UTF8String);
    }

    void App::SetMenu(std::optional<std::reference_wrapper<Menu>> menu) {
        if (!menu.has_value()) {
            NSApp.menu = nil;
            return;
        }
        NSMenu* cocoaMenu = menu->get().impl_->ns_menu;
        for (NSInteger i = 0; i < cocoaMenu.numberOfItems; ++i) {
            NSMenuItem* item = [cocoaMenu itemAtIndex: i];
            [[item submenu] setTitle: [item title]];
        }
        NSApp.menu = cocoaMenu;
    }
}
