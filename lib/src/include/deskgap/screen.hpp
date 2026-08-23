#ifndef DESKGAP_SCREEN_HPP
#define DESKGAP_SCREEN_HPP

#include <cstdint>
#include <string>
#include <vector>

namespace DeskGap {
    class Screen {
    public:
        struct Rectangle {
            int x;
            int y;
            int width;
            int height;
        };

        struct Display {
            int64_t id;
            std::string label;
            Rectangle bounds;
            Rectangle workArea;
            double scaleFactor;
            bool primary;
        };

        static std::vector<Display> GetAllDisplays();
    };
}

#endif
