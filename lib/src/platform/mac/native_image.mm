#import <Cocoa/Cocoa.h>

#include <algorithm>
#include "native_image.hpp"

namespace {
    NSBitmapImageRep* BitmapRepresentation(const DeskGap::NativeImage::Representation& representation) {
        NSBitmapImageRep* bitmap = [[NSBitmapImageRep alloc]
            initWithBitmapDataPlanes: nullptr
            pixelsWide: representation.pixelWidth
            pixelsHigh: representation.pixelHeight
            bitsPerSample: 8
            samplesPerPixel: 4
            hasAlpha: YES
            isPlanar: NO
            colorSpaceName: NSDeviceRGBColorSpace
            bytesPerRow: representation.pixelWidth * 4
            bitsPerPixel: 32
        ];
        if (bitmap != nil) {
            std::copy(
                representation.pixels.begin(),
                representation.pixels.end(),
                [bitmap bitmapData]
            );
        }
        return bitmap;
    }
}

namespace DeskGap {
    std::optional<NativeImage::Representation> NativeImage::Decode(
        const uint8_t* data,
        size_t size,
        double scaleFactor
    ) {
        if (data == nullptr || size == 0) return std::nullopt;
        NSData* imageData = [NSData dataWithBytes: data length: size];
        NSBitmapImageRep* source = [[NSBitmapImageRep alloc] initWithData: imageData];
        if (source == nil) return std::nullopt;

        NSInteger width = [source pixelsWide];
        NSInteger height = [source pixelsHigh];
        Representation result;
        result.pixelWidth = static_cast<int>(width);
        result.pixelHeight = static_cast<int>(height);
        result.scaleFactor = scaleFactor;
        result.pixels.resize(static_cast<size_t>(width) * height * 4);

        NSBitmapImageRep* destination = BitmapRepresentation(result);
        if (destination == nil) return std::nullopt;
        NSGraphicsContext* context = [NSGraphicsContext graphicsContextWithBitmapImageRep: destination];
        [NSGraphicsContext saveGraphicsState];
        [NSGraphicsContext setCurrentContext: context];
        [source drawInRect: NSMakeRect(0, 0, width, height)];
        [NSGraphicsContext restoreGraphicsState];
        std::copy_n([destination bitmapData], result.pixels.size(), result.pixels.begin());
        return result;
    }

    std::vector<uint8_t> NativeImage::EncodeJPEG(const Representation& representation, int quality) {
        NSBitmapImageRep* bitmap = BitmapRepresentation(representation);
        if (bitmap == nil) return {};
        NSData* data = [bitmap representationUsingType: NSBitmapImageFileTypeJPEG properties: @{
            NSImageCompressionFactor: @(quality / 100.0)
        }];
        const uint8_t* bytes = static_cast<const uint8_t*>([data bytes]);
        return bytes == nullptr ? std::vector<uint8_t>() : std::vector<uint8_t>(bytes, bytes + [data length]);
    }

    std::vector<uint8_t> NativeImage::EncodePNG(const Representation& representation) {
        NSBitmapImageRep* bitmap = BitmapRepresentation(representation);
        if (bitmap == nil) return {};
        NSData* data = [bitmap representationUsingType: NSBitmapImageFileTypePNG properties: @{}];
        const uint8_t* bytes = static_cast<const uint8_t*>([data bytes]);
        return bytes == nullptr ? std::vector<uint8_t>() : std::vector<uint8_t>(bytes, bytes + [data length]);
    }
}