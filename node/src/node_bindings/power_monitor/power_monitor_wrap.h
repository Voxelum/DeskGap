#ifndef POWER_MONITOR_POWER_MONITOR_WRAP_H
#define POWER_MONITOR_POWER_MONITOR_WRAP_H

#include <napi.h>

namespace DeskGap {
    Napi::Object PowerMonitorObject(const Napi::Env& env);
}

#endif
