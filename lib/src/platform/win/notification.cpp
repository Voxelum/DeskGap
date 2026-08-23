#include "notification.hpp"
#include "util/wstring_utf8.h"

#include <Windows.h>
#include <ShObjIdl.h>
#include <Shlwapi.h>
#include <filesystem>
#include <fstream>
#include <atomic>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Data.Xml.Dom.h>
#include <winrt/Windows.UI.Notifications.h>

namespace fs = std::filesystem;
using namespace winrt::Windows::Data::Xml::Dom;
using namespace winrt::Windows::UI::Notifications;

namespace {
    struct NotificationRecord {
        explicit NotificationRecord(DeskGap::Notification::EventCallbacks&& callbacks)
            : callbacks(std::move(callbacks)) {}
        DeskGap::Notification::EventCallbacks callbacks;
        std::atomic_bool alive { true };
        std::atomic_bool shown { false };
    };

    std::wstring EscapeXML(const std::string& value) {
        std::wstring result;
        for (wchar_t character: UTF8ToWString(value.c_str())) {
            switch (character) {
            case L'&': result += L"&amp;"; break;
            case L'<': result += L"&lt;"; break;
            case L'>': result += L"&gt;"; break;
            case L'\"': result += L"&quot;"; break;
            case L'\'': result += L"&apos;"; break;
            default: result += character; break;
            }
        }
        return result;
    }

    std::wstring FileURL(const fs::path& path) {
        wchar_t buffer[2048];
        DWORD size = 2048;
        if (SUCCEEDED(UrlCreateFromPathW(path.c_str(), buffer, &size, 0))) return buffer;
        return L"";
    }
}

struct DeskGap::Notification::Impl {
    Options options;
    std::shared_ptr<NotificationRecord> record;
    ToastNotifier notifier { nullptr };
    ToastNotification toast { nullptr };
    winrt::event_token activatedToken { };
    winrt::event_token dismissedToken { };
    winrt::event_token failedToken { };
    fs::path iconPath;

    Impl(Options&& options, EventCallbacks&& callbacks)
        : options(std::move(options)), record(std::make_shared<NotificationRecord>(std::move(callbacks))) {}

    ~Impl() {
        record->alive.store(false);
        Close(false);
        std::error_code error;
        if (!iconPath.empty()) fs::remove(iconPath, error);
    }

    void Show() {
        if (record->shown.load()) return;
        ResetToastHandlers();
        PWSTR appUserModelId = nullptr;
        HRESULT result = GetCurrentProcessExplicitAppUserModelID(&appUserModelId);
        if (FAILED(result) || appUserModelId == nullptr) {
            if (record->alive.load()) record->callbacks.onFailed("Set app.setAppUserModelId before showing Windows notifications");
            return;
        }

        try {
            std::wstring image;
            if (!options.iconPng.empty()) {
                fs::path directory = fs::temp_directory_path() / "DeskGap" / "Notifications";
                std::error_code directoryError;
                fs::create_directories(directory, directoryError);
                if (directoryError) throw std::runtime_error("Failed to create notification icon directory");
                iconPath = directory / (std::to_wstring(reinterpret_cast<uintptr_t>(this)) + L".png");
                std::ofstream stream(iconPath, std::ios::binary);
                if (!stream) throw std::runtime_error("Failed to create notification icon");
                stream.write(reinterpret_cast<const char*>(options.iconPng.data()), options.iconPng.size());
                stream.close();
                if (!stream) throw std::runtime_error("Failed to write notification icon");
                std::wstring uri = FileURL(iconPath);
                if (!uri.empty()) image = L"<image placement=\"appLogoOverride\" src=\"" + uri + L"\"/>";
            }

            std::wstring xml = L"<toast><visual><binding template=\"ToastGeneric\"><text>" +
                EscapeXML(options.title) + L"</text>";
            if (!options.body.empty()) xml += L"<text>" + EscapeXML(options.body) + L"</text>";
            xml += image + L"</binding></visual>";
            if (options.silent) xml += L"<audio silent=\"true\"/>";
            xml += L"</toast>";

            XmlDocument document;
            document.LoadXml(xml);
            toast = ToastNotification(document);
            auto sharedRecord = record;
            activatedToken = toast.Activated([sharedRecord](auto&&, auto&&) {
                if (sharedRecord->alive.load() && sharedRecord->shown.load()) sharedRecord->callbacks.onClick();
            });
            dismissedToken = toast.Dismissed([sharedRecord](auto&&, auto&&) {
                if (sharedRecord->alive.load() && sharedRecord->shown.exchange(false)) sharedRecord->callbacks.onClose();
            });
            failedToken = toast.Failed([sharedRecord](auto&&, ToastFailedEventArgs const& args) {
                sharedRecord->shown.store(false);
                if (sharedRecord->alive.load()) {
                    sharedRecord->callbacks.onFailed("Windows notification failed: " + std::to_string(args.ErrorCode().value));
                }
            });
            notifier = ToastNotificationManager::CreateToastNotifier(appUserModelId);
            CoTaskMemFree(appUserModelId);
            appUserModelId = nullptr;
            record->shown.store(true);
            notifier.Show(toast);
            if (record->alive.load()) record->callbacks.onShow();
        }
        catch (const winrt::hresult_error& error) {
            if (appUserModelId != nullptr) CoTaskMemFree(appUserModelId);
            record->shown.store(false);
            ResetToastHandlers();
            if (record->alive.load()) record->callbacks.onFailed(winrt::to_string(error.message()));
        }
        catch (const std::exception& error) {
            if (appUserModelId != nullptr) CoTaskMemFree(appUserModelId);
            record->shown.store(false);
            ResetToastHandlers();
            if (record->alive.load()) record->callbacks.onFailed(error.what());
        }
    }

    void Close(bool emit = true) {
        bool wasShown = record->shown.exchange(false);
        ToastNotifier currentNotifier = notifier;
        ToastNotification currentToast = toast;
        ResetToastHandlers();
        try {
            if (wasShown && currentNotifier != nullptr && currentToast != nullptr) currentNotifier.Hide(currentToast);
        }
        catch (...) { }
        if (emit && wasShown && record->alive.load()) record->callbacks.onClose();
    }

    void ResetToastHandlers() {
        if (toast != nullptr) {
            try { toast.Activated(activatedToken); } catch (...) { }
            try { toast.Dismissed(dismissedToken); } catch (...) { }
            try { toast.Failed(failedToken); } catch (...) { }
        }
        toast = nullptr;
        notifier = nullptr;
    }
};

DeskGap::Notification::Notification(Options&& options, EventCallbacks&& callbacks)
    : impl_(std::make_unique<Impl>(std::move(options), std::move(callbacks))) {}

DeskGap::Notification::~Notification() = default;
void DeskGap::Notification::Show() { impl_->Show(); }
void DeskGap::Notification::Close() { impl_->Close(); }
bool DeskGap::Notification::IsSupported() { return true; }
