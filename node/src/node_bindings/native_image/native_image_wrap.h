#ifndef native_image_native_image_wrap_h
#define native_image_native_image_wrap_h

#include <deskgap/native_image.hpp>
#include <napi.h>

namespace DeskGap {
    class TrayWrap;

    class NativeImageWrap: public Napi::ObjectWrap<NativeImageWrap> {
    private:
        friend class TrayWrap;

        NativeImage image_;

        void AddRepresentation(const Napi::CallbackInfo& info);
        Napi::Value Crop(const Napi::CallbackInfo& info);
        Napi::Value GetAspectRatio(const Napi::CallbackInfo& info);
        Napi::Value GetBitmap(const Napi::CallbackInfo& info);
        Napi::Value GetScaleFactors(const Napi::CallbackInfo& info);
        Napi::Value GetSize(const Napi::CallbackInfo& info);
        Napi::Value IsEmpty(const Napi::CallbackInfo& info);
        Napi::Value Resize(const Napi::CallbackInfo& info);
        Napi::Value ToJPEG(const Napi::CallbackInfo& info);
        Napi::Value ToPNG(const Napi::CallbackInfo& info);

        static Napi::Object NewInstance(Napi::Env env, NativeImage&& image);
        static Napi::FunctionReference& ConstructorReference();

    public:
        explicit NativeImageWrap(const Napi::CallbackInfo& info);
        static Napi::Function Constructor(const Napi::Env& env);
    };
}

#endif