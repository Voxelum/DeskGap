#include "screen_wrap.h"

#include <deskgap/screen.hpp>
#include "../dispatch/dispatch.h"

namespace {
    Napi::Object RectangleObject(Napi::Env env, const DeskGap::Screen::Rectangle& rectangle) {
        Napi::Object result = Napi::Object::New(env);
        result.Set("x", rectangle.x);
        result.Set("y", rectangle.y);
        result.Set("width", rectangle.width);
        result.Set("height", rectangle.height);
        return result;
    }

    Napi::Object DisplayObject(Napi::Env env, const DeskGap::Screen::Display& display) {
        Napi::Object result = Napi::Object::New(env);
        result.Set("id", Napi::Number::New(env, static_cast<double>(display.id)));
        result.Set("label", display.label);
        result.Set("bounds", RectangleObject(env, display.bounds));
        result.Set("workArea", RectangleObject(env, display.workArea));
        result.Set("scaleFactor", display.scaleFactor);
        result.Set("primary", display.primary);
        return result;
    }
}

Napi::Object DeskGap::ScreenObject(const Napi::Env& env) {
    Napi::Object screenObject = Napi::Object::New(env);
    screenObject.Set("getAllDisplays", Napi::Function::New(env, [](const Napi::CallbackInfo& info) {
        std::vector<Screen::Display> displays;
        UISync(info.Env(), [&displays] { displays = Screen::GetAllDisplays(); });
        Napi::Array result = Napi::Array::New(info.Env(), displays.size());
        for (size_t index = 0; index < displays.size(); ++index) {
            result.Set(static_cast<uint32_t>(index), DisplayObject(info.Env(), displays[index]));
        }
        return result;
    }));
    return screenObject;
}
