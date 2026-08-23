#ifndef DESKGAP_EXTERNAL_WINDOW_HPP
#define DESKGAP_EXTERNAL_WINDOW_HPP

#include <cstdint>
#include <string>

namespace DeskGap::ExternalWindow {
    struct Bounds {
        double x;
        double y;
        double width;
        double height;
    };

    enum class Status {
        SUCCESS,
        NOT_FOUND,
        FAILED,
        UNSUPPORTED,
    };

    struct Result {
        Status status;
        int64_t errorCode = 0;
        std::string message;
    };

    bool IsSupported();
    Result TryMoveAndResize(uint32_t processId, const Bounds& bounds, bool dipCoordinates);
}

#endif