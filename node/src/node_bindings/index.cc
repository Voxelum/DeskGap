#include <memory>
#include <sstream>
#include <napi.h>
#include "index.hpp"
#include "app/app_wrap.h"
#include "window/browser_window_wrap.h"
#include "menu/menu_wrap.h"
#include "shell/shell_wrap.h"
#include "screen/screen_wrap.h"
#include "clipboard/clipboard_wrap.h"
#include "power_monitor/power_monitor_wrap.h"
#include "notification/notification_wrap.h"
#include "credentials/credentials_wrap.h"
#include "tray/tray_wrap.h"
#include "webview/webview_wrap.h"
#include "system_preferences/system_preferences_wrap.h"
#include "dialog/dialog_wrap.h"
#include "native_image/native_image_wrap.h"
#include "windows_app_installer/windows_app_installer_wrap.h"
#include "windows_executable/windows_executable_wrap.h"
#include "external_window/external_window_wrap.h"
#include "dispatch/dispatch.h"
#include "native_exception.h"

namespace {
    std::unique_ptr<Napi::FunctionReference> nativeExceptionConstructor;

    inline void ExportFunction(Napi::Object& exports, const Napi::Function& function) {
        exports.Set(function.Get("name"), function);
    }
}


Napi::Object DeskGap::InitNodeNativeModule(Napi::Env env, Napi::Object exports) {
    exports.Set("appNative", DeskGap::AppWrap::AppObject(env));
    ExportFunction(exports, DeskGap::BrowserWindowWrap::Constructor(env));
    ExportFunction(exports, DeskGap::MenuWrap::Constructor(env));
    ExportFunction(exports, DeskGap::MenuItemWrap::Constructor(env));
    ExportFunction(exports, DeskGap::WebViewWrap::Constructor(env));
    ExportFunction(exports, DeskGap::NativeImageWrap::Constructor(env));
    ExportFunction(exports, DeskGap::TrayWrap::Constructor(env));
    ExportFunction(exports, DeskGap::NotificationWrap::Constructor(env));

    ExportFunction(exports, Napi::Function::New(env, [](const Napi::CallbackInfo&) {
        DeskGap::DelayUISync();
    }, "delayUISync"));

    ExportFunction(exports, Napi::Function::New(env, [](const Napi::CallbackInfo& info) {
        DeskGap::CommitUISync(info.Env());
    }, "commitUISync"));

    ExportFunction(exports, Napi::Function::New(env, [](const Napi::CallbackInfo& info) {
        nativeExceptionConstructor = std::make_unique<Napi::FunctionReference>(Persistent(info[0].As<Napi::Function>()));
    }, "setNativeExceptionConstructor"));

    exports.Set("shellNative", DeskGap::ShellObject(env));
    exports.Set("screenNative", DeskGap::ScreenObject(env));
    exports.Set("clipboardNative", DeskGap::ClipboardObject(env));
    exports.Set("powerMonitorNative", DeskGap::PowerMonitorObject(env));
    exports.Set("credentialsNative", DeskGap::CredentialsObject(env));
    exports.Set("systemPreferencesNative", DeskGap::SystemPreferencesObject(env));
    exports.Set("dialogNative", DeskGap::DialogObject(env));
    exports.Set("windowsAppInstallerNative", DeskGap::WindowsAppInstallerObject(env));
    exports.Set("windowsExecutableNative", DeskGap::WindowsExecutableObject(env));
    exports.Set("externalWindowNative", DeskGap::ExternalWindowObject(env));

    return exports;
}

const Napi::FunctionReference& DeskGap::NativeExceptionConstructor() {
    return *nativeExceptionConstructor;
}
