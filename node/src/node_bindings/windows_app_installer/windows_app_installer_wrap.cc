#include "windows_app_installer_wrap.h"

#include <atomic>
#include <chrono>
#include <iomanip>
#include <memory>
#include <optional>
#include <sstream>
#include <string>
#include <thread>

#ifdef _WIN32
#include <windows.h>
#include <appmodel.h>
#include <winrt/Windows.ApplicationModel.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Management.Deployment.h>
#include <winrt/base.h>
#include "../dispatch/node_dispatch.h"
#endif

namespace {
    struct OperationError {
        bool cancelled = false;
        int32_t hresult = 0;
        std::string message;
    };

    std::string ErrorCode(int32_t hresult) {
        std::ostringstream stream;
        stream << "HRESULT_0x" << std::uppercase << std::hex << std::setw(8)
               << std::setfill('0') << static_cast<uint32_t>(hresult);
        return stream.str();
    }

    class PromiseWorker: public Napi::AsyncWorker {
    public:
        explicit PromiseWorker(Napi::Env env): Napi::AsyncWorker(env), deferred_(Napi::Promise::Deferred::New(env)) {}

        Napi::Promise Promise() const { return deferred_.Promise(); }

        void OnError(const Napi::Error& error) override { deferred_.Reject(error.Value()); }

    protected:
        bool RejectCapturedError() {
            if (operationError_.message.empty()) return false;
            Napi::Object value = Napi::Error::New(Env(), operationError_.message).Value();
            if (operationError_.hresult != 0) {
                value.Set("code", ErrorCode(operationError_.hresult));
                value.Set("hresult", Napi::Number::New(Env(), operationError_.hresult));
            }
            if (operationError_.cancelled) value.Set("name", "AbortError");
            deferred_.Reject(value);
            return true;
        }

        void CaptureError(int32_t hresult, std::string message) {
            operationError_.hresult = hresult;
            operationError_.message = std::move(message);
        }

#ifdef _WIN32
        void CaptureError(const winrt::hresult_error& error) {
            operationError_.hresult = error.code().value;
            operationError_.message = winrt::to_string(error.message());
            operationError_.cancelled = error.code() == E_ABORT || error.code() == HRESULT_FROM_WIN32(ERROR_CANCELLED);
            if (operationError_.message.empty()) operationError_.message = "Windows App Installer operation failed";
        }
#endif
        void CaptureError(const std::exception& error) {
            operationError_.message = error.what();
            if (operationError_.message.empty()) operationError_.message = "Windows App Installer operation failed";
        }

        Napi::Promise::Deferred deferred_;
        OperationError operationError_;
    };

#ifdef _WIN32
    using namespace winrt::Windows::ApplicationModel;
    using namespace winrt::Windows::Foundation;
    using namespace winrt::Windows::Management::Deployment;

    constexpr int32_t noPackageIdentity = static_cast<int32_t>(0x80073D54);

    struct PackageIdentityResult {
        std::string appInstallerUri;
        std::string familyName;
        std::string fullName;
        std::string name;
        std::string publisherId;
        std::string version;
    };

    class PackageIdentityWorker final: public PromiseWorker {
    public:
        explicit PackageIdentityWorker(Napi::Env env): PromiseWorker(env) {}

        void Execute() override {
            try {
                winrt::init_apartment(winrt::apartment_type::multi_threaded);
                Package package = Package::Current();
                PackageId id = package.Id();
                PackageVersion version = id.Version();
                std::ostringstream formattedVersion;
                formattedVersion << version.Major << '.' << version.Minor << '.' << version.Build << '.' << version.Revision;
                result_ = PackageIdentityResult {
                    {},
                    winrt::to_string(id.FamilyName()),
                    winrt::to_string(id.FullName()),
                    winrt::to_string(id.Name()),
                    winrt::to_string(id.PublisherId()),
                    formattedVersion.str(),
                };
                try {
                    AppInstallerInfo info = package.GetAppInstallerInfo();
                    if (info && info.Uri()) result_->appInstallerUri = winrt::to_string(info.Uri().AbsoluteUri());
                }
                catch (const winrt::hresult_error&) {
                }
            }
            catch (const winrt::hresult_error& error) {
                if (error.code().value == noPackageIdentity) return;
                CaptureError(error);
            }
            catch (const std::exception& error) {
                CaptureError(error);
            }
        }

        void OnOK() override {
            if (RejectCapturedError()) return;
            if (!result_.has_value()) {
                deferred_.Resolve(Env().Null());
                return;
            }
            Napi::Object result = Napi::Object::New(Env());
            result.Set("appInstallerUri", result_->appInstallerUri.empty()
                ? static_cast<Napi::Value>(Env().Null())
                : Napi::String::New(Env(), result_->appInstallerUri));
            result.Set("familyName", result_->familyName);
            result.Set("fullName", result_->fullName);
            result.Set("name", result_->name);
            result.Set("publisherId", result_->publisherId);
            result.Set("version", result_->version);
            deferred_.Resolve(result);
        }

    private:
        std::optional<PackageIdentityResult> result_;
    };

    class CheckForUpdatesWorker final: public PromiseWorker {
    public:
        explicit CheckForUpdatesWorker(Napi::Env env): PromiseWorker(env) {}

        void Execute() override {
            try {
                UINT32 packageFullNameLength = 0;
                const LONG identityResult = GetCurrentPackageFullName(&packageFullNameLength, nullptr);
                if (identityResult == APPMODEL_ERROR_NO_PACKAGE) {
                    CaptureError(noPackageIdentity, "The current process does not have Windows package identity");
                    return;
                }
                if (identityResult != ERROR_INSUFFICIENT_BUFFER) {
                    CaptureError(HRESULT_FROM_WIN32(identityResult), "Failed to query the current Windows package identity");
                    return;
                }
                winrt::init_apartment(winrt::apartment_type::multi_threaded);
                result_ = static_cast<int32_t>(Package::Current().CheckUpdateAvailabilityAsync().get().Availability());
            }
            catch (const std::exception& error) {
                CaptureError(error);
            }
        }

        void OnOK() override {
            if (RejectCapturedError()) return;
            deferred_.Resolve(Napi::Number::New(Env(), result_));
        }

    private:
        int32_t result_ = 0;
    };

    struct CancellationState {
        std::atomic<bool> cancelled = false;
    };

    class InstallWorker final: public PromiseWorker {
    public:
        InstallWorker(
            Napi::Env env,
            std::string uri,
            uint32_t options,
            std::shared_ptr<CancellationState> cancellation,
            std::shared_ptr<DeskGap::JSFunctionForUI> progress
        ): PromiseWorker(env),
           uri_(std::move(uri)),
           options_(options),
           cancellation_(std::move(cancellation)),
           progress_(std::move(progress)) {}

        void Execute() override {
            try {
                winrt::init_apartment(winrt::apartment_type::multi_threaded);
                PackageManager manager;
                auto operation = manager.AddPackageByAppInstallerFileAsync(
                    Uri(winrt::to_hstring(uri_)),
                    static_cast<AddPackageByAppInstallerOptions>(options_),
                    nullptr
                );
                operation.Progress([progress = progress_](const auto&, const DeploymentProgress& value) {
                    const int32_t state = static_cast<int32_t>(value.state);
                    const uint32_t percentage = value.percentage;
                    progress->Call([state, percentage](auto env) -> std::vector<napi_value> {
                        return { Napi::Number::New(env, state), Napi::Number::New(env, percentage) };
                    });
                });
                while (operation.Status() == AsyncStatus::Started) {
                    if (cancellation_->cancelled.exchange(false)) operation.Cancel();
                    std::this_thread::sleep_for(std::chrono::milliseconds(25));
                }
                DeploymentResult result = operation.GetResults();
                const int32_t extendedError = result.ExtendedErrorCode();
                if (FAILED(extendedError)) {
                    throw winrt::hresult_error(extendedError, result.ErrorText());
                }
            }
            catch (const std::exception& error) {
                CaptureError(error);
            }
        }

        void OnOK() override {
            if (RejectCapturedError()) return;
            deferred_.Resolve(Env().Undefined());
        }

    private:
        std::string uri_;
        uint32_t options_;
        std::shared_ptr<CancellationState> cancellation_;
        std::shared_ptr<DeskGap::JSFunctionForUI> progress_;
    };

    bool IsSupportedWindowsVersion() {
        using RtlGetVersion = LONG(WINAPI*)(PRTL_OSVERSIONINFOW);
        HMODULE ntdll = GetModuleHandleW(L"ntdll.dll");
        auto getVersion = reinterpret_cast<RtlGetVersion>(GetProcAddress(ntdll, "RtlGetVersion"));
        if (getVersion == nullptr) return false;
        RTL_OSVERSIONINFOW version {};
        version.dwOSVersionInfoSize = sizeof(version);
        return getVersion(&version) == 0 && version.dwMajorVersion >= 10 && version.dwBuildNumber >= 17763;
    }
#endif
}

Napi::Object DeskGap::WindowsAppInstallerObject(const Napi::Env& env) {
    Napi::Object object = Napi::Object::New(env);
#ifdef _WIN32
    object.Set("isSupported", Napi::Function::New(env, [](const Napi::CallbackInfo& info) {
        return Napi::Boolean::New(info.Env(), IsSupportedWindowsVersion());
    }));
    object.Set("getPackageIdentity", Napi::Function::New(env, [](const Napi::CallbackInfo& info) {
        auto* worker = new PackageIdentityWorker(info.Env());
        Napi::Promise promise = worker->Promise();
        worker->Queue();
        return promise;
    }));
    object.Set("checkForUpdates", Napi::Function::New(env, [](const Napi::CallbackInfo& info) {
        auto* worker = new CheckForUpdatesWorker(info.Env());
        Napi::Promise promise = worker->Promise();
        worker->Queue();
        return promise;
    }));
    object.Set("install", Napi::Function::New(env, [](const Napi::CallbackInfo& info) {
        auto cancellation = std::make_shared<CancellationState>();
        auto progress = JSFunctionForUI::Persist(info[2].As<Napi::Function>(), true);
        auto* worker = new InstallWorker(
            info.Env(),
            info[0].As<Napi::String>().Utf8Value(),
            info[1].As<Napi::Number>().Uint32Value(),
            cancellation,
            std::move(progress)
        );
        Napi::Object result = Napi::Object::New(info.Env());
        result.Set("promise", worker->Promise());
        result.Set("cancel", Napi::Function::New(info.Env(), [cancellation](const Napi::CallbackInfo&) {
            cancellation->cancelled = true;
        }));
        worker->Queue();
        return result;
    }));
#else
    object.Set("isSupported", Napi::Function::New(env, [](const Napi::CallbackInfo& info) {
        return Napi::Boolean::New(info.Env(), false);
    }));
#endif
    return object;
}