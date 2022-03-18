// https://source.chromium.org/chromium/chromium/src/+/main:base/win/registry.cc
// Copyright (c) 2012 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef WIN_UTIL_REG_KEY
#define WIN_UTIL_REG_KEY

#include <Windows.h>
#include <string>

namespace DeskGap {
    class RegKey {
      public:
        RegKey() : key_(nullptr) {}
        RegKey(HKEY hKey) : key_(hKey) {}
        RegKey(HKEY rootkey, const wchar_t *subkey, REGSAM access) : key_(nullptr) { Open(rootkey, subkey, access); }

        ~RegKey() { Close(); }

        void Close() {
            if (key_) {
                ::RegCloseKey(key_);
                key_ = nullptr;
            }
        }

        LONG Open(HKEY rootkey, const wchar_t *subkey, REGSAM access) {
            HKEY subhkey = nullptr;

            LONG result = RegOpenKeyEx(rootkey, subkey, 0, access, &subhkey);
            if (result == ERROR_SUCCESS) {
                Close();
                key_ = subhkey;
            }

            return result;
        }

        LONG ReadValue(const wchar_t *name, std::wstring *out_value) {
            const size_t kMaxStringLength = 1024; // This is after expansion.
            // Use the one of the other forms of ReadValue if 1024 is too small for you.
            wchar_t raw_value[kMaxStringLength];
            DWORD type = REG_SZ, size = sizeof(raw_value);
            LONG result = RegQueryValueEx(key_, name, nullptr, &type, reinterpret_cast<LPBYTE>(raw_value), &size);
            // ReadValue(name, raw_value, &size, &type);
            if (result == ERROR_SUCCESS) {
                if (type == REG_SZ) {
                    *out_value = raw_value;
                } else if (type == REG_EXPAND_SZ) {
                    wchar_t expanded[kMaxStringLength];
                    size = ExpandEnvironmentStrings(raw_value, expanded, kMaxStringLength);
                    // Success: returns the number of wchar_t's copied
                    // Fail: buffer too small, returns the size required
                    // Fail: other, returns 0
                    if (size == 0 || size > kMaxStringLength) {
                        result = ERROR_MORE_DATA;
                    } else {
                        *out_value = expanded;
                    }
                } else {
                    // Not a string. Oops.
                    result = ERROR_CANTREAD;
                }
            }

            return result;
        }

        LONG RegKey::WriteValue(const wchar_t *name, const void *data, DWORD dsize, DWORD dtype) {
            LONG result = RegSetValueEx(key_, name, 0, dtype, reinterpret_cast<LPBYTE>(const_cast<void *>(data)), dsize);
            return result;
        }

        LONG RegKey::WriteValue(const wchar_t *name, const wchar_t *in_value) {
            return WriteValue(name, in_value, static_cast<DWORD>(sizeof(*in_value) * (std::char_traits<wchar_t>::length(in_value) + 1)), REG_SZ);
        }

      private:
        HKEY key_ = nullptr;
    };
} // namespace DeskGap

#endif /* WIN_UTIL_REG_KEY */
