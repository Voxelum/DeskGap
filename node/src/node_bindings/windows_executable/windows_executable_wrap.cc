#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <wincrypt.h>
#include <wintrust.h>
#include <softpub.h>
#include "../../windows/pe_authenticode.h"
#endif

#include "windows_executable_wrap.h"

#include <algorithm>
#include <cstdint>
#include <iomanip>
#include <limits>
#include <memory>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace {
#ifdef _WIN32
    class Handle {
    public:
        explicit Handle(HANDLE value): value_(value) {}
        ~Handle() { if (value_ != nullptr && value_ != INVALID_HANDLE_VALUE) CloseHandle(value_); }
        Handle(const Handle&) = delete;
        Handle& operator=(const Handle&) = delete;
        HANDLE Get() const { return value_; }
    private:
        HANDLE value_;
    };

    class FileView {
    public:
        explicit FileView(HANDLE mapping): data_(MapViewOfFile(mapping, FILE_MAP_READ, 0, 0, 0)) {
            if (data_ == nullptr) throw std::runtime_error("Cannot map Windows executable for verification");
        }
        ~FileView() { UnmapViewOfFile(data_); }
        FileView(const FileView&) = delete;
        FileView& operator=(const FileView&) = delete;
        const std::uint8_t* Data() const { return static_cast<const std::uint8_t*>(data_); }
    private:
        const void* data_;
    };

    class TrustState {
    public:
        explicit TrustState(WINTRUST_FILE_INFO& file) {
            data.cbStruct = sizeof(data);
            data.dwUIChoice = WTD_UI_NONE;
            data.fdwRevocationChecks = WTD_REVOKE_WHOLECHAIN;
            data.dwUnionChoice = WTD_CHOICE_FILE;
            data.pFile = &file;
            data.dwStateAction = WTD_STATEACTION_VERIFY;
            // Keep Windows' timestamp-aware trust policy, with online revocation checking.
            data.dwProvFlags = WTD_REVOCATION_CHECK_CHAIN_EXCLUDE_ROOT;
        }
        ~TrustState() {
            data.dwStateAction = WTD_STATEACTION_CLOSE;
            WinVerifyTrust(reinterpret_cast<HWND>(INVALID_HANDLE_VALUE), &action, &data);
        }
        TrustState(const TrustState&) = delete;
        TrustState& operator=(const TrustState&) = delete;
        GUID action = WINTRUST_ACTION_GENERIC_VERIFY_V2;
        WINTRUST_DATA data{};
    };

    std::runtime_error WindowsError(const char* operation, LONG status) {
        std::ostringstream message;
        message << operation << " failed (0x" << std::hex << std::uppercase << std::setw(8)
                << std::setfill('0') << static_cast<std::uint32_t>(status) << ')';
        return std::runtime_error(message.str());
    }

    void Verify(const std::u16string& path, const std::vector<std::u16string>& expectedPublishers) {
        const std::wstring widePath(path.begin(), path.end());
        // A competing writable handle causes this open to fail; verification never shares write/delete access.
        Handle file(CreateFileW(widePath.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL, nullptr));
        if (file.Get() == INVALID_HANDLE_VALUE) throw WindowsError("Opening executable", GetLastError());
        LARGE_INTEGER size{};
        if (!GetFileSizeEx(file.Get(), &size)) throw WindowsError("Reading executable size", GetLastError());
        if (size.QuadPart <= 0 || static_cast<unsigned long long>(size.QuadPart) > (std::numeric_limits<std::size_t>::max)()) {
            throw std::runtime_error("Windows executable size is invalid");
        }
        Handle mapping(CreateFileMappingW(file.Get(), nullptr, PAGE_READONLY, 0, 0, nullptr));
        if (mapping.Get() == nullptr) throw WindowsError("Mapping executable", GetLastError());
        FileView view(mapping.Get());
        const auto layout = DeskGap::ReadPeAuthenticodeLayout({view.Data(), static_cast<std::size_t>(size.QuadPart)});
        if (!layout.hasCertificates) throw std::runtime_error("Windows executable has no embedded Authenticode signature");

        WINTRUST_FILE_INFO fileInfo{};
        fileInfo.cbStruct = sizeof(fileInfo);
        fileInfo.pcwszFilePath = widePath.c_str();
        fileInfo.hFile = file.Get();
        TrustState trust(fileInfo);
        const LONG status = WinVerifyTrust(reinterpret_cast<HWND>(INVALID_HANDLE_VALUE), &trust.action, &trust.data);
        if (status != ERROR_SUCCESS) throw WindowsError("Authenticode verification", status);

        auto* provider = WTHelperProvDataFromStateData(trust.data.hWVTStateData);
        auto* signer = provider == nullptr ? nullptr : WTHelperGetProvSignerFromChain(provider, 0, FALSE, 0);
        auto* certificate = signer == nullptr ? nullptr : WTHelperGetProvCertFromChain(signer, 0);
        if (signer == nullptr || signer->dwError != ERROR_SUCCESS || certificate == nullptr ||
            certificate->pCert == nullptr || certificate->pCert->pCertInfo == nullptr) {
            throw std::runtime_error("Validated Authenticode signer certificate is unavailable");
        }
        // Match the entire subject, case-sensitively, in Windows reverse X.500 display form (CN first).
        // This includes Windows' attribute aliases, quoting and spacing; a common-name-only pin is not a match.
        constexpr DWORD nameFlags = CERT_X500_NAME_STR | CERT_NAME_STR_REVERSE_FLAG;
        auto& subject = certificate->pCert->pCertInfo->Subject;
        const DWORD length = CertNameToStrW(X509_ASN_ENCODING, &subject, nameFlags, nullptr, 0);
        if (length <= 1) throw std::runtime_error("Validated Authenticode signer subject is empty");
        std::wstring rendered(length, L'\0');
        if (CertNameToStrW(X509_ASN_ENCODING, &subject, nameFlags, rendered.data(), length) != length) {
            throw WindowsError("Reading Authenticode signer subject", GetLastError());
        }
        rendered.resize(length - 1);
        const std::u16string actual(rendered.begin(), rendered.end());
        if (std::find(expectedPublishers.begin(), expectedPublishers.end(), actual) == expectedPublishers.end()) {
            throw std::runtime_error("Authenticode signer does not match an expected full X.500 publisher subject");
        }
    }
#endif

    class VerifyWorker final: public Napi::AsyncWorker {
    public:
        VerifyWorker(Napi::Env env, std::u16string path, std::vector<std::u16string> publishers):
            Napi::AsyncWorker(env), deferred_(Napi::Promise::Deferred::New(env)),
            path_(std::move(path)), publishers_(std::move(publishers)) {}

        Napi::Promise Promise() const { return deferred_.Promise(); }

        void Execute() override {
#ifdef _WIN32
            try {
                Verify(path_, publishers_);
            }
            catch (const std::exception& error) {
                SetError(error.what());
            }
#else
            SetError("Windows executable signature verification is not supported on this platform");
#endif
        }

        void OnOK() override { deferred_.Resolve(Env().Undefined()); }
        void OnError(const Napi::Error& error) override { deferred_.Reject(error.Value()); }

    private:
        Napi::Promise::Deferred deferred_;
        std::u16string path_;
        std::vector<std::u16string> publishers_;
    };

    bool ValidString(const std::u16string& value) {
        if (value.empty() || value.find(u'\0') != std::u16string::npos) return false;
        for (std::size_t index = 0; index < value.size(); ++index) {
            const auto character = value[index];
            if (character >= 0xd800 && character <= 0xdbff) {
                if (++index == value.size() || value[index] < 0xdc00 || value[index] > 0xdfff) return false;
            }
            else if (character >= 0xdc00 && character <= 0xdfff) return false;
        }
        return true;
    }

    Napi::Value VerifySignature(const Napi::CallbackInfo& info) {
        auto rejected = Napi::Promise::Deferred::New(info.Env());
        try {
            if (info.Length() != 2 || !info[0].IsString() || !info[1].IsArray()) {
                throw Napi::TypeError::New(info.Env(), "Expected executable path and an array of full X.500 publisher subjects");
            }
            auto path = info[0].As<Napi::String>().Utf16Value();
            auto publishers = info[1].As<Napi::Array>();
            if (!ValidString(path) || publishers.Length() == 0) {
                throw Napi::TypeError::New(info.Env(), "Executable path and expected publisher subjects must not be empty or contain NUL");
            }
            std::vector<std::u16string> expected;
            expected.reserve(publishers.Length());
            for (std::uint32_t index = 0; index < publishers.Length(); ++index) {
                auto value = publishers.Get(index);
                if (!value.IsString()) throw Napi::TypeError::New(info.Env(), "Expected publisher subjects must be strings");
                auto subject = value.As<Napi::String>().Utf16Value();
                if (!ValidString(subject)) throw Napi::TypeError::New(info.Env(), "Expected publisher subjects must be valid nonempty Unicode without NUL");
                expected.push_back(std::move(subject));
            }
            auto worker = std::make_unique<VerifyWorker>(info.Env(), std::move(path), std::move(expected));
            auto promise = worker->Promise();
            worker->Queue();
            worker.release();
            return promise;
        }
        catch (const Napi::Error& error) {
            rejected.Reject(error.Value());
            return rejected.Promise();
        }
    }
}

Napi::Object DeskGap::WindowsExecutableObject(const Napi::Env& env) {
    auto object = Napi::Object::New(env);
    object.Set("verifySignature", Napi::Function::New(env, VerifySignature));
    return object;
}
