#ifndef CREDENTIALS_CREDENTIALS_WRAP_H
#define CREDENTIALS_CREDENTIALS_WRAP_H

#include <napi.h>

namespace DeskGap {
    Napi::Object CredentialsObject(const Napi::Env& env);
}

#endif
