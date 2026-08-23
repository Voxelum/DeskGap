#ifndef DESKGAP_NATIVE_IMAGE_HPP
#define DESKGAP_NATIVE_IMAGE_HPP

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace DeskGap {
    class NativeImage {
    public:
        struct Size {
            int width;
            int height;
        };

        struct Rectangle: Size {
            int x;
            int y;
        };

        struct Representation {
            std::vector<uint8_t> pixels;
            int pixelWidth;
            int pixelHeight;
            double scaleFactor;
        };

        NativeImage() = default;

        static NativeImage CreateFromBitmap(
            const uint8_t* pixels,
            size_t size,
            int width,
            int height,
            double scaleFactor
        );
        static NativeImage CreateFromBuffer(const uint8_t* data, size_t size, double scaleFactor = 1.0);
        static NativeImage CreateFromPath(const std::string& path);

        void AddRepresentation(const uint8_t* data, size_t size, double scaleFactor = 1.0);
        void AddBitmapRepresentation(
            const uint8_t* pixels,
            size_t size,
            int width,
            int height,
            double scaleFactor = 1.0
        );
        NativeImage Crop(const Rectangle& rectangle) const;
        NativeImage Resize(const Size& size) const;
        bool IsEmpty() const;
        double GetAspectRatio(double scaleFactor = 1.0) const;
        std::vector<uint8_t> GetBitmap(double scaleFactor = 1.0) const;
        std::vector<double> GetScaleFactors() const;
        Size GetSize(double scaleFactor = 1.0) const;
        std::vector<uint8_t> ToJPEG(int quality) const;
        std::vector<uint8_t> ToPNG(double scaleFactor = 1.0) const;

        const Representation* GetRepresentation(double scaleFactor = 1.0) const;

    private:
        explicit NativeImage(std::vector<Representation>&& representations);

        static std::optional<Representation> Decode(const uint8_t* data, size_t size, double scaleFactor);
        static std::vector<uint8_t> EncodeJPEG(const Representation& representation, int quality);
        static std::vector<uint8_t> EncodePNG(const Representation& representation);
        void SetRepresentation(Representation&& representation);

        std::vector<Representation> representations_;
    };
}

#endif