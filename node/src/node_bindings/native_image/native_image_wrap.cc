#include "native_image_wrap.h"

#include <algorithm>

namespace {
    double ScaleFactor(const Napi::Value& value, double fallback = 1.0) {
        return value.IsNumber() ? value.As<Napi::Number>().DoubleValue() : fallback;
    }

    Napi::Buffer<uint8_t> BufferFrom(Napi::Env env, std::vector<uint8_t>&& bytes) {
        return Napi::Buffer<uint8_t>::Copy(env, bytes.data(), bytes.size());
    }
}

namespace DeskGap {
    Napi::FunctionReference& NativeImageWrap::ConstructorReference() {
        static Napi::FunctionReference constructor;
        return constructor;
    }

    Napi::Function NativeImageWrap::Constructor(const Napi::Env& env) {
        Napi::Function constructor = DefineClass(env, "NativeImageNative", {
            InstanceMethod("addRepresentation", &NativeImageWrap::AddRepresentation),
            InstanceMethod("crop", &NativeImageWrap::Crop),
            InstanceMethod("getAspectRatio", &NativeImageWrap::GetAspectRatio),
            InstanceMethod("getBitmap", &NativeImageWrap::GetBitmap),
            InstanceMethod("getScaleFactors", &NativeImageWrap::GetScaleFactors),
            InstanceMethod("getSize", &NativeImageWrap::GetSize),
            InstanceMethod("isEmpty", &NativeImageWrap::IsEmpty),
            InstanceMethod("resize", &NativeImageWrap::Resize),
            InstanceMethod("toJPEG", &NativeImageWrap::ToJPEG),
            InstanceMethod("toPNG", &NativeImageWrap::ToPNG),
        });
        ConstructorReference() = Napi::Persistent(constructor);
        ConstructorReference().SuppressDestruct();
        return constructor;
    }

    NativeImageWrap::NativeImageWrap(const Napi::CallbackInfo& info)
        : Napi::ObjectWrap<NativeImageWrap>(info) {
        if (info.Length() == 0 || info[0].IsUndefined()) return;

        int sourceType = info[0].As<Napi::Number>().Int32Value();
        if (sourceType == 0) {
            image_ = NativeImage::CreateFromPath(info[1].As<Napi::String>().Utf8Value());
        }
        else if (sourceType == 1) {
            auto buffer = info[1].As<Napi::Buffer<uint8_t>>();
            image_ = NativeImage::CreateFromBuffer(
                buffer.Data(), buffer.Length(), ScaleFactor(info[2])
            );
        }
        else if (sourceType == 2) {
            auto buffer = info[1].As<Napi::Buffer<uint8_t>>();
            image_ = NativeImage::CreateFromBitmap(
                buffer.Data(),
                buffer.Length(),
                info[2].As<Napi::Number>().Int32Value(),
                info[3].As<Napi::Number>().Int32Value(),
                ScaleFactor(info[4])
            );
        }
    }

    Napi::Object NativeImageWrap::NewInstance(Napi::Env env, NativeImage&& image) {
        Napi::Object instance = ConstructorReference().New({});
        Unwrap(instance)->image_ = std::move(image);
        return instance;
    }

    void NativeImageWrap::AddRepresentation(const Napi::CallbackInfo& info) {
        auto buffer = info[0].As<Napi::Buffer<uint8_t>>();
        bool hasWidth = info[1].IsNumber();
        bool hasHeight = info[2].IsNumber();
        if (hasWidth != hasHeight) {
            Napi::TypeError::New(info.Env(), "Bitmap width and height must be specified together")
                .ThrowAsJavaScriptException();
            return;
        }
        if (hasWidth) {
            image_.AddBitmapRepresentation(
                buffer.Data(),
                buffer.Length(),
                info[1].As<Napi::Number>().Int32Value(),
                info[2].As<Napi::Number>().Int32Value(),
                ScaleFactor(info[3])
            );
        }
        else {
            image_.AddRepresentation(buffer.Data(), buffer.Length(), ScaleFactor(info[3]));
        }
    }

    Napi::Value NativeImageWrap::Crop(const Napi::CallbackInfo& info) {
        Napi::Object rectangle = info[0].As<Napi::Object>();
        return NewInstance(info.Env(), image_.Crop({
            rectangle.Get("width").As<Napi::Number>().Int32Value(),
            rectangle.Get("height").As<Napi::Number>().Int32Value(),
            rectangle.Get("x").As<Napi::Number>().Int32Value(),
            rectangle.Get("y").As<Napi::Number>().Int32Value(),
        }));
    }

    Napi::Value NativeImageWrap::GetAspectRatio(const Napi::CallbackInfo& info) {
        return Napi::Number::New(info.Env(), image_.GetAspectRatio(ScaleFactor(info[0])));
    }

    Napi::Value NativeImageWrap::GetBitmap(const Napi::CallbackInfo& info) {
        return BufferFrom(info.Env(), image_.GetBitmap(ScaleFactor(info[0])));
    }

    Napi::Value NativeImageWrap::GetScaleFactors(const Napi::CallbackInfo& info) {
        std::vector<double> scaleFactors = image_.GetScaleFactors();
        Napi::Array result = Napi::Array::New(info.Env(), scaleFactors.size());
        for (size_t index = 0; index < scaleFactors.size(); ++index) {
            result.Set(index, Napi::Number::New(info.Env(), scaleFactors[index]));
        }
        return result;
    }

    Napi::Value NativeImageWrap::GetSize(const Napi::CallbackInfo& info) {
        NativeImage::Size size = image_.GetSize(ScaleFactor(info[0]));
        Napi::Object result = Napi::Object::New(info.Env());
        result.Set("width", size.width);
        result.Set("height", size.height);
        return result;
    }

    Napi::Value NativeImageWrap::IsEmpty(const Napi::CallbackInfo& info) {
        return Napi::Boolean::New(info.Env(), image_.IsEmpty());
    }

    Napi::Value NativeImageWrap::Resize(const Napi::CallbackInfo& info) {
        int width = info[0].IsNumber() ? info[0].As<Napi::Number>().Int32Value() : 0;
        int height = info[1].IsNumber() ? info[1].As<Napi::Number>().Int32Value() : 0;
        return NewInstance(info.Env(), image_.Resize({ width, height }));
    }

    Napi::Value NativeImageWrap::ToJPEG(const Napi::CallbackInfo& info) {
        return BufferFrom(info.Env(), image_.ToJPEG(info[0].As<Napi::Number>().Int32Value()));
    }

    Napi::Value NativeImageWrap::ToPNG(const Napi::CallbackInfo& info) {
        return BufferFrom(info.Env(), image_.ToPNG(ScaleFactor(info[0])));
    }
}