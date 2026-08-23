#include "power_monitor.hpp"

#include <Windows.h>
#include <optional>

namespace {
    DeskGap::PowerMonitor::EventCallbacks eventCallbacks;
    std::optional<bool> lastOnBattery;
}

bool DeskGap::PowerMonitor::IsOnBatteryPower() {
    SYSTEM_POWER_STATUS status { };
    return GetSystemPowerStatus(&status) && status.ACLineStatus == 0;
}

void DeskGap::PowerMonitor::SetEventCallbacks(EventCallbacks&& callbacks) {
    eventCallbacks = std::move(callbacks);
    lastOnBattery = IsOnBatteryPower();
}

void DeskGap::PowerMonitor::ProcessPowerBroadcast(std::uintptr_t event) {
    switch (event) {
    case PBT_APMSUSPEND:
        if (eventCallbacks.onSuspend) eventCallbacks.onSuspend();
        break;
    case PBT_APMRESUMEAUTOMATIC:
        if (eventCallbacks.onResume) eventCallbacks.onResume();
        break;
    case PBT_APMPOWERSTATUSCHANGE: {
        bool onBattery = IsOnBatteryPower();
        if (!lastOnBattery.has_value() || *lastOnBattery != onBattery) {
            lastOnBattery = onBattery;
            if (eventCallbacks.onPowerSourceChanged) eventCallbacks.onPowerSourceChanged(onBattery);
        }
        break;
    }
    }
}
