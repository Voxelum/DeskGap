#ifndef DESKGAP_NOTIFICATION_HPP
#define DESKGAP_NOTIFICATION_HPP

#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <vector>

namespace DeskGap {
    class Notification {
    public:
        struct Options {
            std::string title;
            std::string body;
            std::vector<uint8_t> iconPng;
            bool silent;
        };

        struct EventCallbacks {
            std::function<void()> onShow;
            std::function<void()> onClick;
            std::function<void()> onClose;
            std::function<void(const std::string&)> onFailed;
        };

        Notification(Options&& options, EventCallbacks&& callbacks);
        ~Notification();
        Notification(const Notification&) = delete;
        Notification& operator=(const Notification&) = delete;

        void Show();
        void Close();
        static bool IsSupported();

    private:
        struct Impl;
        std::unique_ptr<Impl> impl_;
    };
}

#endif
