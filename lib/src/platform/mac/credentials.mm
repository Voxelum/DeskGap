#import <Foundation/Foundation.h>
#import <Security/Security.h>

#include "credentials.hpp"
#include "util/string_convert.h"

#include <stdexcept>

namespace {
    NSMutableDictionary* Query(const std::string& service, const std::optional<std::string>& account) {
        NSMutableDictionary* query = [@{
            (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
            (__bridge id)kSecAttrService: NSStr(service),
        } mutableCopy];
        if (account.has_value()) query[(__bridge id)kSecAttrAccount] = NSStr(*account);
        return query;
    }

    std::runtime_error KeychainError(const char* operation, OSStatus status) {
        CFStringRef message = SecCopyErrorMessageString(status, nullptr);
        std::string description = message == nullptr ? std::to_string(status) : CXXStr((__bridge NSString*)message);
        if (message != nullptr) CFRelease(message);
        return std::runtime_error(std::string(operation) + " failed: " + description);
    }
}

std::optional<std::string> DeskGap::Credentials::GetPassword(
    const std::string& service,
    const std::string& account
) {
    NSMutableDictionary* query = Query(service, account);
    query[(__bridge id)kSecReturnData] = @YES;
    query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
    CFTypeRef result = nullptr;
    OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
    if (status == errSecItemNotFound) return std::nullopt;
    if (status != errSecSuccess) throw KeychainError("SecItemCopyMatching", status);
    NSData* data = CFBridgingRelease(result);
    return std::string(static_cast<const char*>(data.bytes), data.length);
}

void DeskGap::Credentials::SetPassword(
    const std::string& service,
    const std::string& account,
    const std::string& password
) {
    NSMutableDictionary* query = Query(service, account);
    NSData* data = [NSData dataWithBytes:password.data() length:password.size()];
    OSStatus status = SecItemUpdate(
        (__bridge CFDictionaryRef)query,
        (__bridge CFDictionaryRef)@{ (__bridge id)kSecValueData: data }
    );
    if (status == errSecItemNotFound) {
        query[(__bridge id)kSecValueData] = data;
        status = SecItemAdd((__bridge CFDictionaryRef)query, nullptr);
    }
    if (status != errSecSuccess) throw KeychainError("SecItemUpdate", status);
}

bool DeskGap::Credentials::DeletePassword(const std::string& service, const std::string& account) {
    OSStatus status = SecItemDelete((__bridge CFDictionaryRef)Query(service, account));
    if (status == errSecItemNotFound) return false;
    if (status != errSecSuccess) throw KeychainError("SecItemDelete", status);
    return true;
}

std::vector<DeskGap::Credentials::Credential> DeskGap::Credentials::FindCredentials(const std::string& service) {
    NSMutableDictionary* query = Query(service, std::nullopt);
    query[(__bridge id)kSecReturnAttributes] = @YES;
    query[(__bridge id)kSecReturnData] = @YES;
    query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitAll;
    CFTypeRef result = nullptr;
    OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
    if (status == errSecItemNotFound) return {};
    if (status != errSecSuccess) throw KeychainError("SecItemCopyMatching", status);

    NSArray<NSDictionary*>* items = CFBridgingRelease(result);
    std::vector<Credential> credentials;
    credentials.reserve(items.count);
    for (NSDictionary* item in items) {
        NSString* account = item[(__bridge id)kSecAttrAccount];
        NSData* data = item[(__bridge id)kSecValueData];
        if (account == nil || data == nil) continue;
        credentials.push_back({
            CXXStr(account),
            std::string(static_cast<const char*>(data.bytes), data.length),
        });
    }
    return credentials;
}
