#ifndef DESKGAP_EXTERNAL_WINDOW_WRAP_H
#define DESKGAP_EXTERNAL_WINDOW_WRAP_H

#include <napi.h>

namespace DeskGap {
    Napi::Object ExternalWindowObject(const Napi::Env& env);
}

#endif