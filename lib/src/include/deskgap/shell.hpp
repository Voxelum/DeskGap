#ifndef DESKGAP_SHELL_HPP
#define DESKGAP_SHELL_HPP

#include <optional>
#include <string>

namespace DeskGap {
    class Shell {
    public:
        struct ShortcutDetails {
            std::optional<std::string> target;
            std::optional<std::string> cwd;
            std::optional<std::string> args;
            std::optional<std::string> description;
            std::optional<std::string> icon;
            int iconIndex;
            std::optional<std::string> appUserModelId;
            std::optional<std::string> toastActivatorClsid;
        };

        static bool OpenExternal(const std::string& path);
        static std::string OpenPath(const std::string& path);
        static bool ShowItemInFolder(const std::string& path);
        static bool WriteShortcutLink(
            const std::string& shortcutPath,
            const std::string& operation,
            const ShortcutDetails& details
        );
    };
}

#endif
