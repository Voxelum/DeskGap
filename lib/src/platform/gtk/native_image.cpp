#include "native_image.hpp"

#include <gdk-pixbuf/gdk-pixbuf.h>

namespace {
    std::vector<uint8_t> Encode(
        const DeskGap::NativeImage::Representation& representation,
        const char* format,
        const char* quality = nullptr
    ) {
        GdkPixbuf* pixbuf = gdk_pixbuf_new_from_data(
            representation.pixels.data(),
            GDK_COLORSPACE_RGB,
            TRUE,
            8,
            representation.pixelWidth,
            representation.pixelHeight,
            representation.pixelWidth * 4,
            nullptr,
            nullptr
        );
        if (pixbuf == nullptr) return {};

        gchar* buffer = nullptr;
        gsize size = 0;
        GError* error = nullptr;
        gboolean success = quality == nullptr
            ? gdk_pixbuf_save_to_buffer(pixbuf, &buffer, &size, format, &error, nullptr)
            : gdk_pixbuf_save_to_buffer(pixbuf, &buffer, &size, format, &error, "quality", quality, nullptr);
        g_object_unref(pixbuf);
        if (!success) {
            if (error != nullptr) g_error_free(error);
            return {};
        }
        std::vector<uint8_t> result(buffer, buffer + size);
        g_free(buffer);
        return result;
    }
}

namespace DeskGap {
    std::optional<NativeImage::Representation> NativeImage::Decode(
        const uint8_t* data,
        size_t size,
        double scaleFactor
    ) {
        GdkPixbufLoader* loader = gdk_pixbuf_loader_new();
        GError* error = nullptr;
        if (!gdk_pixbuf_loader_write(loader, data, size, &error) ||
            !gdk_pixbuf_loader_close(loader, &error)) {
            if (error != nullptr) g_error_free(error);
            g_object_unref(loader);
            return std::nullopt;
        }

        GdkPixbuf* pixbuf = gdk_pixbuf_loader_get_pixbuf(loader);
        if (pixbuf == nullptr) {
            g_object_unref(loader);
            return std::nullopt;
        }
        g_object_ref(pixbuf);
        g_object_unref(loader);

        Representation result;
        result.pixelWidth = gdk_pixbuf_get_width(pixbuf);
        result.pixelHeight = gdk_pixbuf_get_height(pixbuf);
        result.scaleFactor = scaleFactor;
        result.pixels.resize(static_cast<size_t>(result.pixelWidth) * result.pixelHeight * 4);

        const guchar* source = gdk_pixbuf_read_pixels(pixbuf);
        int rowStride = gdk_pixbuf_get_rowstride(pixbuf);
        int channels = gdk_pixbuf_get_n_channels(pixbuf);
        for (int y = 0; y < result.pixelHeight; ++y) {
            for (int x = 0; x < result.pixelWidth; ++x) {
                const guchar* sourcePixel = source + y * rowStride + x * channels;
                uint8_t* destination = result.pixels.data() + (static_cast<size_t>(y) * result.pixelWidth + x) * 4;
                destination[0] = sourcePixel[0];
                destination[1] = sourcePixel[1];
                destination[2] = sourcePixel[2];
                destination[3] = channels == 4 ? sourcePixel[3] : 255;
            }
        }
        g_object_unref(pixbuf);
        return result;
    }

    std::vector<uint8_t> NativeImage::EncodeJPEG(const Representation& representation, int quality) {
        std::string qualityString = std::to_string(quality);
        return Encode(representation, "jpeg", qualityString.c_str());
    }

    std::vector<uint8_t> NativeImage::EncodePNG(const Representation& representation) {
        return Encode(representation, "png");
    }
}