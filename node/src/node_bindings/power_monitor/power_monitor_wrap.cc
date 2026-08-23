#include "power_monitor_wrap.h"

#include <deskgap/power_monitor.hpp>
#include "../dispatch/dispatch.h"

Napi::Object DeskGap::PowerMonitorObject(const Napi::Env& env) {
    Napi::Object powerMonitorObject = Napi::Object::New(env);
    powerMonitorObject.Set("isOnBatteryPower", Napi::Function::New(env, [](const Napi::CallbackInfo& info) {
        bool onBattery;
        UISync(info.Env(), [&onBattery] { onBattery = PowerMonitor::IsOnBatteryPower(); });
        return Napi::Boolean::New(info.Env(), onBattery);
    }));
    powerMonitorObject.Set("startMonitoring", Napi::Function::New(env, [](const Napi::CallbackInfo& info) {
        Napi::Object jsCallbacks = info[0].As<Napi::Object>();
        auto jsOnSuspend = JSFunctionForUI::Persist(jsCallbacks.Get("onSuspend").As<Napi::Function>(), true);
        auto jsOnResume = JSFunctionForUI::Persist(jsCallbacks.Get("onResume").As<Napi::Function>(), true);
        auto jsOnPowerSourceChanged = JSFunctionForUI::Persist(
            jsCallbacks.Get("onPowerSourceChanged").As<Napi::Function>(), true
        );

        UISyncDelayable(info.Env(), [
            jsOnSuspend = std::move(jsOnSuspend),
            jsOnResume = std::move(jsOnResume),
            jsOnPowerSourceChanged = std::move(jsOnPowerSourceChanged)
        ]() mutable {
            PowerMonitor::SetEventCallbacks({
                [jsOnSuspend] { jsOnSuspend->Call(); },
                [jsOnResume] { jsOnResume->Call(); },
                [jsOnPowerSourceChanged](bool onBattery) {
                    jsOnPowerSourceChanged->Call([onBattery](auto env) -> std::vector<napi_value> {
                        return { Napi::Boolean::New(env, onBattery) };
                    });
                },
            });
        });
    }));
    return powerMonitorObject;
}
