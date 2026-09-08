// Copyright 2018 Cheng Zhao. All rights reserved.
// Copyright 2013 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE.chromium file.
#include <memory.h>
#include <array>

#include "tray.hpp"
#include "dispatch_wnd.hpp"
#include "menu_impl.h"
#include "tray_impl.h"
#include "util/wstring_utf8.h"

namespace {
    UINT kBaseIconId = 2;
} // namespace

namespace DeskGap {
    LRESULT OnTrayClick(WPARAM wp, LPARAM lp) {
        Tray::Impl *tray = nullptr;
        for (auto t : tray_instances_) {
            if (t->icon_id_ == wp) {
                tray = t;
                break;
            }
        }

        if (!tray) {
            return 0;
        }

        switch (lp) {
        case WM_LBUTTONDOWN:
        case WM_LBUTTONUP:
        case WM_LBUTTONDBLCLK:
        case WM_RBUTTONDOWN:
        case WM_RBUTTONUP:
        case WM_CONTEXTMENU:
            tray->OnClick(lp);
            return 0;
        }

        return 0;
    }

    Tray::Impl::Impl(const EventCallbacks &&callbacks)
        : icon_id_(kBaseIconId++), callbacks_(callbacks) {
        NOTIFYICONDATA icon_data;
        InitIconData(&icon_data);
        icon_data.uFlags |= NIF_MESSAGE;
        icon_data.uCallbackMessage = DG_TRAY_MSG;

        BOOL result = Shell_NotifyIcon(NIM_ADD, &icon_data);
        // This can happen if the explorer process isn't running when we try
        // to create the icon for some reason (for example, at startup).
        // if (!result)
        //     LOG(WARNING) << "Unable to create status tray icon.";

        // Track the tray impl
        tray_instances_.push_back(this);
    }

    void Tray::Impl::InitIconData(NOTIFYICONDATA *icon_data) {
        memset(icon_data, 0, sizeof(NOTIFYICONDATA));
        icon_data->cbSize = sizeof(NOTIFYICONDATA);
        icon_data->hWnd = appWindowWnd;
        icon_data->uID = icon_id_;
        // if (is_using_guid_) {
        //     icon_data->uFlags = NIF_GUID;
        //     icon_data->guidItem = guid_;
        // }
    }

    void Tray::Impl::OnClick(LPARAM lp) {
        if (lp == WM_LBUTTONDOWN) {
            callbacks_.onClick();
        } else if (lp == WM_LBUTTONDBLCLK) {
            callbacks_.onDoubleClick();
        } else if (lp == WM_RBUTTONDOWN || lp == WM_CONTEXTMENU) {
            callbacks_.onRightClick();
        }
    }

    void Tray::Impl::SetTooltip(const std::string &tooltip) {
        NOTIFYICONDATA icon_data;
        InitIconData(&icon_data);

        std::wstring tooltip_ = UTF8ToWString(tooltip.c_str());
        icon_data.uFlags = NIF_TIP;
        memcpy(icon_data.szTip, tooltip_.c_str(), 128);
        BOOL result = Shell_NotifyIcon(NIM_MODIFY, &icon_data);
    }

    void Tray::Impl::SetImage(const NativeImage& image) {
        const NativeImage::Representation* representation = image.GetRepresentation();
        if (representation == nullptr) return;

        BITMAPV5HEADER bitmapHeader{};
        bitmapHeader.bV5Size = sizeof(bitmapHeader);
        bitmapHeader.bV5Width = representation->pixelWidth;
        bitmapHeader.bV5Height = -representation->pixelHeight;
        bitmapHeader.bV5Planes = 1;
        bitmapHeader.bV5BitCount = 32;
        bitmapHeader.bV5Compression = BI_BITFIELDS;
        bitmapHeader.bV5RedMask = 0x00ff0000;
        bitmapHeader.bV5GreenMask = 0x0000ff00;
        bitmapHeader.bV5BlueMask = 0x000000ff;
        bitmapHeader.bV5AlphaMask = 0xff000000;

        void* bitmapPixels = nullptr;
        HDC screen = GetDC(nullptr);
        HBITMAP colorBitmap = CreateDIBSection(
            screen,
            reinterpret_cast<BITMAPINFO*>(&bitmapHeader),
            DIB_RGB_COLORS,
            &bitmapPixels,
            nullptr,
            0
        );
        ReleaseDC(nullptr, screen);
        if (colorBitmap == nullptr || bitmapPixels == nullptr) return;

        uint8_t* destination = static_cast<uint8_t*>(bitmapPixels);
        for (size_t index = 0; index < representation->pixels.size(); index += 4) {
            destination[index] = representation->pixels[index + 2];
            destination[index + 1] = representation->pixels[index + 1];
            destination[index + 2] = representation->pixels[index];
            destination[index + 3] = representation->pixels[index + 3];
        }

        HBITMAP maskBitmap = CreateBitmap(
            representation->pixelWidth,
            representation->pixelHeight,
            1,
            1,
            nullptr
        );
        ICONINFO iconInfo{};
        iconInfo.fIcon = TRUE;
        iconInfo.hbmColor = colorBitmap;
        iconInfo.hbmMask = maskBitmap;
        HICON icon = CreateIconIndirect(&iconInfo);
        DeleteObject(colorBitmap);
        DeleteObject(maskBitmap);
        if (icon == nullptr) return;

        NOTIFYICONDATA icon_data;
        InitIconData(&icon_data);
        icon_data.uFlags = NIF_ICON;
        icon_data.hIcon = icon;
        Shell_NotifyIcon(NIM_MODIFY, &icon_data);
        if (icon_ != nullptr) DestroyIcon(icon_);
        icon_ = icon;
    }

    void Tray::Impl::Remove() {
        NOTIFYICONDATA icon_data;
        InitIconData(&icon_data);
        Shell_NotifyIcon(NIM_DELETE, &icon_data);
        if (icon_ != nullptr) {
            DestroyIcon(icon_);
            icon_ = nullptr;
        }

        // Untrack the tray impl
        tray_instances_.erase(
            std::remove(tray_instances_.begin(), tray_instances_.end(), this));
    }

    Tray::Impl::~Impl() { Remove(); }

    void Tray::Destroy() {
        if (impl_) {
            delete impl_;
            impl_ = nullptr;
        }
    }
    bool Tray::isDestroyed() { return impl_ == nullptr; }

    void Tray::SetImage(const NativeImage& image) {
        if (impl_) {
            impl_->SetImage(image);
        }
    }

    void Tray::PopupMenu(const Menu& menu, const std::array<int, 2>* location, int positioningItem, std::function<void()>&& onClose) {
        if (impl_) {
            SetForegroundWindow(appWindowWnd);

            UINT uFlags = TPM_RIGHTBUTTON;
            if (GetSystemMetrics(SM_MENUDROPALIGNMENT) != 0)
            {
                uFlags |= TPM_RIGHTALIGN;
            }
            else
            {
                uFlags |= TPM_LEFTALIGN;
            }

            POINT pt;
            if (location != nullptr) {
                pt.x = std::get<0>(*location);
                pt.y = std::get<1>(*location);
                ClientToScreen(appWindowWnd, &pt);
            }
            else {
                GetCursorPos(&pt);
            }

            TrackPopupMenuEx(menu.impl_->hmenu, uFlags, pt.x, pt.y, appWindowWnd, NULL);
            onClose();
        }
    }

    void Tray::SetTooltip(const std::string &tooltip) {
        if (impl_) {
            impl_->SetTooltip(tooltip);
        }
    }

    void Tray::SetTitle(const std::string &title) {}

    std::string Tray::GetTitle() { return ""; }

    Tray::Tray(const NativeImage& image,
               const EventCallbacks &&eventCallbacks)
        : impl_(new Impl(std::move(eventCallbacks))) {
        impl_->SetImage(image);
    }

    Tray::~Tray() { Destroy(); }
} // namespace DeskGap
