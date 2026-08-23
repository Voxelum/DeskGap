#ifndef DESKGAP_POWER_MONITOR_HPP
#define DESKGAP_POWER_MONITOR_HPP

#include <cstdint>
#include <functional>

namespace DeskGap {
    class PowerMonitor {
    public:
        struct EventCallbacks {
            std::function<void()> onSuspend;
            std::function<void()> onResume;
            std::function<void(bool)> onPowerSourceChanged;
        };

        static bool IsOnBatteryPower();
        static void SetEventCallbacks(EventCallbacks&& callbacks);
        static void ProcessPowerBroadcast(std::uintptr_t event);
    };
}

#endif
