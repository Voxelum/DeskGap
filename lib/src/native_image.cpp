#include "include/deskgap/native_image.hpp"

#include <algorithm>
#include <cmath>
#include <fstream>
#include <iterator>
#include <stdexcept>

namespace DeskGap {
    NativeImage::NativeImage(std::vector<Representation>&& representations)
        : representations_(std::move(representations)) {}

    NativeImage NativeImage::CreateFromBitmap(
        const uint8_t* pixels,
        size_t size,
        int width,
        int height,
        double scaleFactor
    ) {
        if (width <= 0 || height <= 0 || !std::isfinite(scaleFactor) || scaleFactor <= 0 ||
            size != static_cast<size_t>(width) * static_cast<size_t>(height) * 4) {
            throw std::invalid_argument("Invalid bitmap dimensions");
        }

        Representation representation {
            std::vector<uint8_t>(pixels, pixels + size),
            width,
            height,
            scaleFactor
        };
        std::vector<Representation> representations;
        representations.push_back(std::move(representation));
        return NativeImage(std::move(representations));
    }

    NativeImage NativeImage::CreateFromBuffer(const uint8_t* data, size_t size, double scaleFactor) {
        if (!std::isfinite(scaleFactor) || scaleFactor <= 0) {
            throw std::invalid_argument("Invalid scale factor");
        }
        auto representation = Decode(data, size, scaleFactor);
        if (!representation.has_value()) return NativeImage();

        std::vector<Representation> representations;
        representations.push_back(std::move(*representation));
        return NativeImage(std::move(representations));
    }

    NativeImage NativeImage::CreateFromPath(const std::string& path) {
        std::ifstream stream(path, std::ios::binary);
        if (!stream) return NativeImage();
        std::vector<uint8_t> data {
            std::istreambuf_iterator<char>(stream),
            std::istreambuf_iterator<char>()
        };
        return CreateFromBuffer(data.data(), data.size());
    }

    void NativeImage::AddRepresentation(const uint8_t* data, size_t size, double scaleFactor) {
        if (!std::isfinite(scaleFactor) || scaleFactor <= 0) {
            throw std::invalid_argument("Invalid scale factor");
        }
        auto representation = Decode(data, size, scaleFactor);
        if (!representation.has_value()) {
            throw std::invalid_argument("Unsupported image data");
        }
        SetRepresentation(std::move(*representation));
    }

    void NativeImage::AddBitmapRepresentation(
        const uint8_t* pixels,
        size_t size,
        int width,
        int height,
        double scaleFactor
    ) {
        NativeImage image = CreateFromBitmap(pixels, size, width, height, scaleFactor);
        SetRepresentation(std::move(image.representations_.front()));
    }

    void NativeImage::SetRepresentation(Representation&& representation) {
        double scaleFactor = representation.scaleFactor;
        auto existing = std::find_if(
            representations_.begin(),
            representations_.end(),
            [scaleFactor](const Representation& candidate) {
                return candidate.scaleFactor == scaleFactor;
            }
        );
        if (existing == representations_.end()) {
            representations_.push_back(std::move(representation));
        }
        else {
            *existing = std::move(representation);
        }
    }

    NativeImage NativeImage::Crop(const Rectangle& rectangle) const {
        const Representation* source = GetRepresentation();
        if (source == nullptr) return NativeImage();
        if (rectangle.x < 0 || rectangle.y < 0 || rectangle.width <= 0 || rectangle.height <= 0 ||
            rectangle.x + rectangle.width > source->pixelWidth ||
            rectangle.y + rectangle.height > source->pixelHeight) {
            throw std::out_of_range("Crop rectangle is outside the image");
        }

        std::vector<uint8_t> pixels(
            static_cast<size_t>(rectangle.width) * static_cast<size_t>(rectangle.height) * 4
        );
        for (int row = 0; row < rectangle.height; ++row) {
            size_t sourceOffset = (
                static_cast<size_t>(rectangle.y + row) * source->pixelWidth + rectangle.x
            ) * 4;
            size_t destinationOffset = static_cast<size_t>(row) * rectangle.width * 4;
            std::copy_n(
                source->pixels.begin() + sourceOffset,
                static_cast<size_t>(rectangle.width) * 4,
                pixels.begin() + destinationOffset
            );
        }
        return CreateFromBitmap(
            pixels.data(), pixels.size(), rectangle.width, rectangle.height, source->scaleFactor
        );
    }

    NativeImage NativeImage::Resize(const Size& size) const {
        const Representation* source = GetRepresentation();
        if (source == nullptr) return NativeImage();
        if (size.width < 0 || size.height < 0 || (size.width == 0 && size.height == 0)) {
            throw std::invalid_argument("Invalid resize dimensions");
        }

        int width = size.width;
        int height = size.height;
        if (width == 0) width = static_cast<int>(std::round(source->pixelWidth * height / static_cast<double>(source->pixelHeight)));
        if (height == 0) height = static_cast<int>(std::round(source->pixelHeight * width / static_cast<double>(source->pixelWidth)));

        std::vector<uint8_t> pixels(static_cast<size_t>(width) * static_cast<size_t>(height) * 4);
        for (int y = 0; y < height; ++y) {
            int sourceY = std::min(source->pixelHeight - 1, y * source->pixelHeight / height);
            for (int x = 0; x < width; ++x) {
                int sourceX = std::min(source->pixelWidth - 1, x * source->pixelWidth / width);
                size_t sourceOffset = (static_cast<size_t>(sourceY) * source->pixelWidth + sourceX) * 4;
                size_t destinationOffset = (static_cast<size_t>(y) * width + x) * 4;
                std::copy_n(source->pixels.begin() + sourceOffset, 4, pixels.begin() + destinationOffset);
            }
        }
        return CreateFromBitmap(pixels.data(), pixels.size(), width, height, source->scaleFactor);
    }

    bool NativeImage::IsEmpty() const {
        return representations_.empty();
    }

    double NativeImage::GetAspectRatio(double scaleFactor) const {
        const Representation* representation = GetRepresentation(scaleFactor);
        if (representation == nullptr || representation->pixelHeight == 0) return 1.0;
        return representation->pixelWidth / static_cast<double>(representation->pixelHeight);
    }

    std::vector<uint8_t> NativeImage::GetBitmap(double scaleFactor) const {
        const Representation* representation = GetRepresentation(scaleFactor);
        return representation == nullptr ? std::vector<uint8_t>() : representation->pixels;
    }

    std::vector<double> NativeImage::GetScaleFactors() const {
        std::vector<double> scaleFactors;
        scaleFactors.reserve(representations_.size());
        for (const Representation& representation: representations_) {
            scaleFactors.push_back(representation.scaleFactor);
        }
        std::sort(scaleFactors.begin(), scaleFactors.end());
        return scaleFactors;
    }

    NativeImage::Size NativeImage::GetSize(double scaleFactor) const {
        const Representation* representation = GetRepresentation(scaleFactor);
        if (representation == nullptr) return { 0, 0 };
        return {
            static_cast<int>(std::round(representation->pixelWidth / representation->scaleFactor)),
            static_cast<int>(std::round(representation->pixelHeight / representation->scaleFactor))
        };
    }

    std::vector<uint8_t> NativeImage::ToJPEG(int quality) const {
        const Representation* representation = GetRepresentation();
        if (representation == nullptr) return {};
        return EncodeJPEG(*representation, std::clamp(quality, 0, 100));
    }

    std::vector<uint8_t> NativeImage::ToPNG(double scaleFactor) const {
        const Representation* representation = GetRepresentation(scaleFactor);
        if (representation == nullptr) return {};
        return EncodePNG(*representation);
    }

    const NativeImage::Representation* NativeImage::GetRepresentation(double scaleFactor) const {
        if (representations_.empty()) return nullptr;
        auto closest = representations_.begin();
        for (auto candidate = representations_.begin(); candidate != representations_.end(); ++candidate) {
            if (std::abs(candidate->scaleFactor - scaleFactor) < std::abs(closest->scaleFactor - scaleFactor)) {
                closest = candidate;
            }
        }
        return &*closest;
    }
}