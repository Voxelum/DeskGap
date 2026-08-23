#ifndef CLIPBOARD_CLIPBOARD_WRAP_H
#define CLIPBOARD_CLIPBOARD_WRAP_H

#include <napi.h>

namespace DeskGap {
    Napi::Object ClipboardObject(const Napi::Env& env);
}

#endif
