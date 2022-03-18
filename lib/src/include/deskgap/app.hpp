#ifndef DESKGAP_APP
#define DESKGAP_APP

#include <functional>
#include <memory>
#include "menu.hpp"
#include <string>

namespace DeskGap {
    class App {
    public:
        struct EventCallbacks {
            std::function<void()> onReady;
            std::function<void()> beforeQuit;
        };

        using SecondInstanceEventCallback = std::function<void(const std::string &&, const std::string &&)>;

        static void Init();
        static bool RequestSingleInstanceLock(SecondInstanceEventCallback&& callback);
        static bool HasSingleInstanceLock();
        static void ReleaseSingleInstanceLock();
        static bool SetAsDefaultProtocolClient(const std::string &);
        static bool IsDefaultProtocolClient(const std::string &);
        static void Run(EventCallbacks&& callbacks);
        static void Exit(int exitCode);

        enum class PathName: uint32_t {
            APP_DATA = 0,
            TEMP = 1,
            DESKTOP = 2,
            DOCUMENTS = 3,
            DOWNLOADS = 4,
            MUSIC = 5,
            PICTURES = 6,
            VIDEOS = 7,
            HOME = 8,
        };
    #ifdef __APPLE__
        static void SetMenu(std::optional<std::reference_wrapper<Menu>> menu);
    #endif
        static std::string GetPath(PathName name);
        static std::string GetExecutablePath();
        static std::string GetResourcePath(const char* argv0);
    };
}

#endif /* DESKGAP_APP */
