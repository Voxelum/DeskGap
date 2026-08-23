#ifndef NOTIFICATION_NOTIFICATION_WRAP_H
#define NOTIFICATION_NOTIFICATION_WRAP_H

#include <deskgap/notification.hpp>
#include <napi.h>
#include <memory>

namespace DeskGap {
    class NotificationWrap: public Napi::ObjectWrap<NotificationWrap> {
    public:
        explicit NotificationWrap(const Napi::CallbackInfo& info);
        static Napi::Function Constructor(const Napi::Env& env);

    private:
        std::unique_ptr<Notification> notification_;
        void Show(const Napi::CallbackInfo& info);
        void Close(const Napi::CallbackInfo& info);
        static Napi::Value IsSupported(const Napi::CallbackInfo& info);
    };
}

#endif
