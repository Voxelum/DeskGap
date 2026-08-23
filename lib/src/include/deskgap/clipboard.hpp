#ifndef DESKGAP_CLIPBOARD_HPP
#define DESKGAP_CLIPBOARD_HPP

#include <cstdint>
#include <string>
#include <vector>

namespace DeskGap {
    class Clipboard {
    public:
        static std::string ReadText();
        static bool WriteText(const std::string& text);
        static bool WriteImage(const std::vector<uint8_t>& png);
    };
}

#endif
