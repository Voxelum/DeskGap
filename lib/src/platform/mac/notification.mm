#import <UserNotifications/UserNotifications.h>

#include "notification.hpp"
#include "util/string_convert.h"

#include <atomic>
#include <mutex>
#include <unordered_map>

namespace {
    struct NotificationRecord {
        NotificationRecord(DeskGap::Notification::EventCallbacks&& callbacks, bool silent)
            : callbacks(std::move(callbacks)), silent(silent) {}
        DeskGap::Notification::EventCallbacks callbacks;
        bool silent;
        std::atomic_bool alive { true };
        std::atomic_bool active { false };
        std::atomic_bool requesting { false };
        std::atomic_uint64_t generation { 0 };
    };

    std::mutex recordsMutex;
    std::unordered_map<std::string, std::shared_ptr<NotificationRecord>> records;
    std::atomic_uint64_t nextNotificationId { 1 };
    NSString* const categoryIdentifier = @"deskgap.notification";

    std::shared_ptr<NotificationRecord> FindRecord(NSString* identifier) {
        std::lock_guard<std::mutex> lock(recordsMutex);
        auto record = records.find(CXXStr(identifier));
        return record == records.end() ? nullptr : record->second;
    }
}

@interface DeskGapNotificationDelegate: NSObject <UNUserNotificationCenterDelegate>
@end

@implementation DeskGapNotificationDelegate
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
       willPresentNotification:(UNNotification *)notification
         withCompletionHandler:(void (^)(UNNotificationPresentationOptions options))completionHandler {
        auto record = FindRecord(notification.request.identifier);
        UNNotificationPresentationOptions options = UNNotificationPresentationOptionBanner;
        if (record != nullptr && !record->silent) options |= UNNotificationPresentationOptionSound;
        completionHandler(options);
}

- (void)userNotificationCenter:(UNUserNotificationCenter *)center
 didReceiveNotificationResponse:(UNNotificationResponse *)response
         withCompletionHandler:(void (^)(void))completionHandler {
    auto record = FindRecord(response.notification.request.identifier);
    if (record != nullptr && record->alive.load() && record->active.exchange(false)) {
        if ([response.actionIdentifier isEqualToString:UNNotificationDefaultActionIdentifier]) {
            record->callbacks.onClick();
            record->callbacks.onClose();
        }
        else if ([response.actionIdentifier isEqualToString:UNNotificationDismissActionIdentifier]) {
            record->callbacks.onClose();
        }
    }
    completionHandler();
}
@end

struct DeskGap::Notification::Impl {
    Options options;
    std::string identifier;
    std::shared_ptr<NotificationRecord> record;

    Impl(Options&& options, EventCallbacks&& callbacks)
        : options(std::move(options)),
          identifier("deskgap-" + std::to_string(nextNotificationId.fetch_add(1))),
                    record(std::make_shared<NotificationRecord>(std::move(callbacks), this->options.silent)) {
        static DeskGapNotificationDelegate* delegate = [DeskGapNotificationDelegate new];
        UNUserNotificationCenter* center = [UNUserNotificationCenter currentNotificationCenter];
        center.delegate = delegate;
        UNNotificationCategory* category = [UNNotificationCategory
            categoryWithIdentifier:categoryIdentifier
            actions:@[]
            intentIdentifiers:@[]
            options:UNNotificationCategoryOptionCustomDismissAction];
        [center setNotificationCategories:[NSSet setWithObject:category]];
        std::lock_guard<std::mutex> lock(recordsMutex);
        records.emplace(identifier, record);
    }

    ~Impl() {
        record->alive.store(false);
        Close(false);
        std::lock_guard<std::mutex> lock(recordsMutex);
        records.erase(identifier);
    }

    void Show() {
        if (record->active.load() || record->requesting.exchange(true)) return;
        const uint64_t generation = record->generation.fetch_add(1) + 1;
        UNUserNotificationCenter* center = [UNUserNotificationCenter currentNotificationCenter];
        auto sharedRecord = record;
        Options copiedOptions = options;
        NSString* requestIdentifier = NSStr(identifier);
        UNAuthorizationOptions authorization = UNAuthorizationOptionAlert;
        if (!copiedOptions.silent) authorization |= UNAuthorizationOptionSound;
        [center requestAuthorizationWithOptions:authorization
                              completionHandler:^(BOOL granted, NSError* error) {
            if (!sharedRecord->alive.load() || sharedRecord->generation.load() != generation) return;
            if (!granted) {
                sharedRecord->requesting.store(false);
                sharedRecord->callbacks.onFailed(error == nil ? "Notification permission was denied" : CXXStr(error.localizedDescription));
                return;
            }
            UNMutableNotificationContent* content = [UNMutableNotificationContent new];
            content.title = NSStr(copiedOptions.title);
            content.body = NSStr(copiedOptions.body);
            content.categoryIdentifier = categoryIdentifier;
            if (!copiedOptions.silent) content.sound = [UNNotificationSound defaultSound];
            NSString* attachmentPath = nil;
            if (!copiedOptions.iconPng.empty()) {
                attachmentPath = [NSTemporaryDirectory() stringByAppendingPathComponent:[requestIdentifier stringByAppendingString:@".png"]];
                NSData* iconData = [NSData dataWithBytes:copiedOptions.iconPng.data() length:copiedOptions.iconPng.size()];
                NSError* writeError = nil;
                if ([iconData writeToFile:attachmentPath options:NSDataWritingAtomic error:&writeError]) {
                    NSError* attachmentError = nil;
                    UNNotificationAttachment* attachment = [UNNotificationAttachment
                        attachmentWithIdentifier:@"icon"
                        URL:[NSURL fileURLWithPath:attachmentPath]
                        options:nil
                        error:&attachmentError];
                    if (attachment != nil) content.attachments = @[ attachment ];
                }
            }
            UNNotificationRequest* request = [UNNotificationRequest
                requestWithIdentifier:requestIdentifier
                content:content
                trigger:nil];
            [center addNotificationRequest:request withCompletionHandler:^(NSError* addError) {
                if (attachmentPath != nil) [[NSFileManager defaultManager] removeItemAtPath:attachmentPath error:nil];
                if (!sharedRecord->alive.load() || sharedRecord->generation.load() != generation) {
                    [center removePendingNotificationRequestsWithIdentifiers:@[ requestIdentifier ]];
                    [center removeDeliveredNotificationsWithIdentifiers:@[ requestIdentifier ]];
                    return;
                }
                sharedRecord->requesting.store(false);
                if (addError != nil) {
                    sharedRecord->callbacks.onFailed(CXXStr(addError.localizedDescription));
                    return;
                }
                sharedRecord->active.store(true);
                sharedRecord->callbacks.onShow();
            }];
        }];
    }

    void Close(bool emit = true) {
        record->generation.fetch_add(1);
        record->requesting.store(false);
        bool wasActive = record->active.exchange(false);
        NSArray<NSString*>* identifiers = @[ NSStr(identifier) ];
        UNUserNotificationCenter* center = [UNUserNotificationCenter currentNotificationCenter];
        [center removePendingNotificationRequestsWithIdentifiers:identifiers];
        [center removeDeliveredNotificationsWithIdentifiers:identifiers];
        if (emit && wasActive && record->alive.load()) record->callbacks.onClose();
    }
};

DeskGap::Notification::Notification(Options&& options, EventCallbacks&& callbacks)
    : impl_(std::make_unique<Impl>(std::move(options), std::move(callbacks))) {}
DeskGap::Notification::~Notification() = default;
void DeskGap::Notification::Show() { impl_->Show(); }
void DeskGap::Notification::Close() { impl_->Close(); }
bool DeskGap::Notification::IsSupported() { return true; }
