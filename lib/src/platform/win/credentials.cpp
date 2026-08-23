#include "credentials.hpp"
#include "util/wstring_utf8.h"

#include <Windows.h>
#include <wincred.h>
#include <stdexcept>

namespace {
    std::string HexEncode(const std::string& value) {
        static const char digits[] = "0123456789abcdef";
        std::string encoded;
        encoded.reserve(value.size() * 2);
        for (unsigned char byte: value) {
            encoded.push_back(digits[byte >> 4]);
            encoded.push_back(digits[byte & 0x0f]);
        }
        return encoded;
    }

    std::optional<std::string> HexDecode(const std::string& value) {
        if ((value.size() & 1) != 0) return std::nullopt;
        auto nibble = [](char character) -> int {
            if (character >= '0' && character <= '9') return character - '0';
            if (character >= 'a' && character <= 'f') return character - 'a' + 10;
            return -1;
        };
        std::string decoded;
        decoded.reserve(value.size() / 2);
        for (size_t index = 0; index < value.size(); index += 2) {
            int high = nibble(value[index]);
            int low = nibble(value[index + 1]);
            if (high < 0 || low < 0) return std::nullopt;
            decoded.push_back(static_cast<char>((high << 4) | low));
        }
        return decoded;
    }

    std::wstring TargetPrefix(const std::string& service) {
        return UTF8ToWString(("DeskGap:" + HexEncode(service) + ":").c_str());
    }

    std::wstring TargetName(const std::string& service, const std::string& account) {
        return TargetPrefix(service) + UTF8ToWString(HexEncode(account).c_str());
    }

    std::runtime_error CredentialError(const char* operation) {
        return std::runtime_error(std::string(operation) + " failed with Windows error " + std::to_string(GetLastError()));
    }
}

std::optional<std::string> DeskGap::Credentials::GetPassword(const std::string& service, const std::string& account) {
    PCREDENTIALW credential = nullptr;
    std::wstring target = TargetName(service, account);
    if (!CredReadW(target.c_str(), CRED_TYPE_GENERIC, 0, &credential)) {
        if (GetLastError() == ERROR_NOT_FOUND) return std::nullopt;
        throw CredentialError("CredRead");
    }
    std::string password(
        reinterpret_cast<const char*>(credential->CredentialBlob),
        reinterpret_cast<const char*>(credential->CredentialBlob) + credential->CredentialBlobSize
    );
    CredFree(credential);
    return password;
}

void DeskGap::Credentials::SetPassword(
    const std::string& service,
    const std::string& account,
    const std::string& password
) {
    if (password.size() > CRED_MAX_CREDENTIAL_BLOB_SIZE) {
        throw std::invalid_argument("Password is too large for Windows Credential Manager");
    }
    std::wstring target = TargetName(service, account);
    std::wstring userName = UTF8ToWString(account.c_str());
    CREDENTIALW credential { };
    credential.Type = CRED_TYPE_GENERIC;
    credential.TargetName = target.data();
    credential.CredentialBlobSize = static_cast<DWORD>(password.size());
    credential.CredentialBlob = reinterpret_cast<LPBYTE>(const_cast<char*>(password.data()));
    credential.Persist = CRED_PERSIST_LOCAL_MACHINE;
    credential.UserName = userName.data();
    if (!CredWriteW(&credential, 0)) throw CredentialError("CredWrite");
}

bool DeskGap::Credentials::DeletePassword(const std::string& service, const std::string& account) {
    std::wstring target = TargetName(service, account);
    if (CredDeleteW(target.c_str(), CRED_TYPE_GENERIC, 0)) return true;
    if (GetLastError() == ERROR_NOT_FOUND) return false;
    throw CredentialError("CredDelete");
}

std::vector<DeskGap::Credentials::Credential> DeskGap::Credentials::FindCredentials(const std::string& service) {
    std::wstring prefix = TargetPrefix(service);
    std::wstring filter = prefix + L"*";
    DWORD count = 0;
    PCREDENTIALW* credentials = nullptr;
    if (!CredEnumerateW(filter.c_str(), 0, &count, &credentials)) {
        if (GetLastError() == ERROR_NOT_FOUND) return {};
        throw CredentialError("CredEnumerate");
    }

    std::vector<Credential> result;
    result.reserve(count);
    for (DWORD index = 0; index < count; ++index) {
        PCREDENTIALW credential = credentials[index];
        std::wstring target(credential->TargetName);
        if (target.rfind(prefix, 0) != 0) continue;
        auto account = HexDecode(WStringToUTF8(target.substr(prefix.size()).c_str()));
        if (!account.has_value()) continue;
        result.push_back({
            std::move(*account),
            std::string(
                reinterpret_cast<const char*>(credential->CredentialBlob),
                reinterpret_cast<const char*>(credential->CredentialBlob) + credential->CredentialBlobSize
            ),
        });
    }
    CredFree(credentials);
    return result;
}
