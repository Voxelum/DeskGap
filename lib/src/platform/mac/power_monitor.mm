#include "power_monitor.hpp"

#import <AppKit/AppKit.h>
#include <IOKit/ps/IOPowerSources.h>
#include <IOKit/ps/IOPSKeys.h>
#include <optional>

namespace {
    DeskGap::PowerMonitor::EventCallbacks eventCallbacks;
    std::optional<bool> lastOnBattery;
    CFRunLoopSourceRef powerSourceRunLoopSource = nullptr;
    id willSleepObserver;
    id didWakeObserver;

    void PowerSourceChanged(void*) {
        bool onBattery = DeskGap::PowerMonitor::IsOnBatteryPower();
        if (!lastOnBattery.has_value() || *lastOnBattery != onBattery) {
            lastOnBattery = onBattery;
            if (eventCallbacks.onPowerSourceChanged) eventCallbacks.onPowerSourceChanged(onBattery);
        }
    }
}

bool DeskGap::PowerMonitor::IsOnBatteryPower() {
    CFTypeRef snapshot = IOPSCopyPowerSourcesInfo();
    if (snapshot == nullptr) return false;
    CFStringRef source = IOPSGetProvidingPowerSourceType(snapshot);
    bool onBattery = source != nullptr && CFEqual(source, kIOPSBatteryPowerValue);
    CFRelease(snapshot);
    return onBattery;
}

void DeskGap::PowerMonitor::SetEventCallbacks(EventCallbacks&& callbacks) {
    eventCallbacks = std::move(callbacks);
    lastOnBattery = IsOnBatteryPower();

    if (powerSourceRunLoopSource == nullptr) {
        powerSourceRunLoopSource = IOPSNotificationCreateRunLoopSource(PowerSourceChanged, nullptr);
        if (powerSourceRunLoopSource != nullptr) {
            CFRunLoopAddSource(CFRunLoopGetMain(), powerSourceRunLoopSource, kCFRunLoopDefaultMode);
        }
    }

    NSNotificationCenter* notificationCenter = [[NSWorkspace sharedWorkspace] notificationCenter];
    if (willSleepObserver == nil) {
        willSleepObserver = [notificationCenter
            addObserverForName:NSWorkspaceWillSleepNotification
            object:nil
            queue:nil
            usingBlock:^(NSNotification*) {
                if (eventCallbacks.onSuspend) eventCallbacks.onSuspend();
            }];
    }
    if (didWakeObserver == nil) {
        didWakeObserver = [notificationCenter
            addObserverForName:NSWorkspaceDidWakeNotification
            object:nil
            queue:nil
            usingBlock:^(NSNotification*) {
                if (eventCallbacks.onResume) eventCallbacks.onResume();
            }];
    }
}
