#ifndef tray_tray_wrap_h
#define tray_tray_wrap_h

#include <deskgap/tray.hpp>
#include <functional>
#include <memory>
#include <napi.h>

namespace DeskGap {
    class TrayWrap : public Napi::ObjectWrap<TrayWrap> {
      private:
        std::unique_ptr<Tray> tray_;
        void SetTooltip(const Napi::CallbackInfo &info);
        void SetIcon(const Napi::CallbackInfo &info);
        void SetTitle(const Napi::CallbackInfo &info);
        void PopupMenu(const Napi::CallbackInfo &info);
        void SetContextMenu(const Napi::CallbackInfo &info);

      public:
        TrayWrap(const Napi::CallbackInfo &info);
        static Napi::Function Constructor(const Napi::Env &env);
    };
} // namespace DeskGap

#endif
