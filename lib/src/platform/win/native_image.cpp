#include "native_image.hpp"

#include <Windows.h>
#include <Shlwapi.h>
#include <wincodec.h>
#include <wrl/client.h>

using Microsoft::WRL::ComPtr;

namespace {
    ComPtr<IWICImagingFactory> ImagingFactory() {
        ComPtr<IWICImagingFactory> factory;
        CoCreateInstance(
            CLSID_WICImagingFactory,
            nullptr,
            CLSCTX_INPROC_SERVER,
            IID_PPV_ARGS(&factory)
        );
        return factory;
    }

    std::vector<uint8_t> Encode(
        const DeskGap::NativeImage::Representation& representation,
        REFGUID containerFormat,
        std::optional<int> quality
    ) {
        ComPtr<IWICImagingFactory> factory = ImagingFactory();
        if (factory == nullptr) return {};

        ComPtr<IStream> stream;
        if (FAILED(CreateStreamOnHGlobal(nullptr, TRUE, &stream))) return {};

        ComPtr<IWICBitmapEncoder> encoder;
        if (FAILED(factory->CreateEncoder(containerFormat, nullptr, &encoder)) ||
            FAILED(encoder->Initialize(stream.Get(), WICBitmapEncoderNoCache))) return {};

        ComPtr<IWICBitmapFrameEncode> frame;
        ComPtr<IPropertyBag2> properties;
        if (FAILED(encoder->CreateNewFrame(&frame, &properties))) return {};
        if (quality.has_value() && properties != nullptr) {
            PROPBAG2 option{};
            option.pstrName = const_cast<LPOLESTR>(L"ImageQuality");
            VARIANT value;
            VariantInit(&value);
            value.vt = VT_R4;
            value.fltVal = *quality / 100.0f;
            properties->Write(1, &option, &value);
            VariantClear(&value);
        }
        if (FAILED(frame->Initialize(properties.Get())) ||
            FAILED(frame->SetSize(representation.pixelWidth, representation.pixelHeight))) return {};

        WICPixelFormatGUID pixelFormat = GUID_WICPixelFormat32bppRGBA;
        if (FAILED(frame->SetPixelFormat(&pixelFormat)) ||
            representation.pixelWidth > static_cast<int>(MAXDWORD / 4) ||
            representation.pixels.size() > MAXDWORD) return {};

        ComPtr<IWICBitmap> bitmap;
        if (FAILED(factory->CreateBitmapFromMemory(
            representation.pixelWidth,
            representation.pixelHeight,
            GUID_WICPixelFormat32bppRGBA,
            representation.pixelWidth * 4,
            static_cast<UINT>(representation.pixels.size()),
            const_cast<BYTE*>(representation.pixels.data()),
            &bitmap
        )) || FAILED(frame->WriteSource(bitmap.Get(), nullptr)) ||
            FAILED(frame->Commit()) || FAILED(encoder->Commit())) return {};

        HGLOBAL global = nullptr;
        if (FAILED(GetHGlobalFromStream(stream.Get(), &global))) return {};
        SIZE_T size = GlobalSize(global);
        const uint8_t* bytes = static_cast<const uint8_t*>(GlobalLock(global));
        if (bytes == nullptr) return {};
        std::vector<uint8_t> result(bytes, bytes + size);
        GlobalUnlock(global);
        return result;
    }
}

namespace DeskGap {
    std::optional<NativeImage::Representation> NativeImage::Decode(
        const uint8_t* data,
        size_t size,
        double scaleFactor
    ) {
        if (data == nullptr || size == 0 || size > MAXDWORD) return std::nullopt;
        ComPtr<IWICImagingFactory> factory = ImagingFactory();
        if (factory == nullptr) return std::nullopt;

        ComPtr<IStream> stream(SHCreateMemStream(data, static_cast<UINT>(size)));
        if (stream == nullptr) return std::nullopt;
        ComPtr<IWICBitmapDecoder> decoder;
        if (FAILED(factory->CreateDecoderFromStream(
            stream.Get(), nullptr, WICDecodeMetadataCacheOnLoad, &decoder
        ))) return std::nullopt;

        ComPtr<IWICBitmapFrameDecode> frame;
        if (FAILED(decoder->GetFrame(0, &frame))) return std::nullopt;
        UINT width = 0;
        UINT height = 0;
        if (FAILED(frame->GetSize(&width, &height))) return std::nullopt;

        ComPtr<IWICFormatConverter> converter;
        if (FAILED(factory->CreateFormatConverter(&converter)) ||
            FAILED(converter->Initialize(
                frame.Get(),
                GUID_WICPixelFormat32bppRGBA,
                WICBitmapDitherTypeNone,
                nullptr,
                0,
                WICBitmapPaletteTypeCustom
            ))) return std::nullopt;

        Representation result;
        result.pixelWidth = static_cast<int>(width);
        result.pixelHeight = static_cast<int>(height);
        result.scaleFactor = scaleFactor;
        result.pixels.resize(static_cast<size_t>(width) * height * 4);
        if (FAILED(converter->CopyPixels(
            nullptr,
            width * 4,
            static_cast<UINT>(result.pixels.size()),
            result.pixels.data()
        ))) return std::nullopt;
        return result;
    }

    std::vector<uint8_t> NativeImage::EncodeJPEG(const Representation& representation, int quality) {
        return Encode(representation, GUID_ContainerFormatJpeg, quality);
    }

    std::vector<uint8_t> NativeImage::EncodePNG(const Representation& representation) {
        return Encode(representation, GUID_ContainerFormatPng, std::nullopt);
    }
}