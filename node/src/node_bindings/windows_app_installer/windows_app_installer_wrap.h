#ifndef DESKGAP_WINDOWS_APP_INSTALLER_WRAP_H
#define DESKGAP_WINDOWS_APP_INSTALLER_WRAP_H

#include <napi.h>

namespace DeskGap {
    Napi::Object WindowsAppInstallerObject(const Napi::Env& env);
}

#endif