#ifndef DESKGAP_PE_AUTHENTICODE_H
#define DESKGAP_PE_AUTHENTICODE_H

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <span>
#include <stdexcept>

namespace DeskGap {
    struct PeAuthenticodeLayout {
        std::size_t contentEnd;
        std::size_t imageEnd;
        bool hasCertificates;
    };

    inline PeAuthenticodeLayout ReadPeAuthenticodeLayout(std::span<const std::uint8_t> bytes) {
        const auto read16 = [&](std::size_t offset) {
            if (offset > bytes.size() || bytes.size() - offset < 2) throw std::runtime_error("PE header is truncated");
            std::uint16_t value;
            std::memcpy(&value, bytes.data() + offset, sizeof(value));
            return value;
        };
        const auto read32 = [&](std::size_t offset) {
            if (offset > bytes.size() || bytes.size() - offset < 4) throw std::runtime_error("PE header is truncated");
            std::uint32_t value;
            std::memcpy(&value, bytes.data() + offset, sizeof(value));
            return value;
        };
        if (bytes.size() < 0x40 || read16(0) != 0x5a4d) throw std::runtime_error("Executable is not a PE file");
        const std::size_t peOffset = read32(0x3c);
        if (peOffset < 0x40 || peOffset > bytes.size() || bytes.size() - peOffset < 24 || read32(peOffset) != 0x4550) {
            throw std::runtime_error("PE header is invalid");
        }
        const std::size_t optionalOffset = peOffset + 24;
        const std::size_t optionalSize = read16(peOffset + 20);
        if (optionalSize < 2 || optionalSize > bytes.size() - optionalOffset) {
            throw std::runtime_error("Optional PE header is truncated");
        }
        const auto magic = read16(optionalOffset);
        const std::size_t directoryOffset = magic == 0x20b ? 112 : magic == 0x10b ? 96 : 0;
        if (directoryOffset == 0 || optionalSize < directoryOffset + 5 * 8) {
            throw std::runtime_error("PE data directories are invalid");
        }
        const auto directoryCount = read32(optionalOffset + directoryOffset - 4);
        if (directoryCount < 5 || directoryCount > (optionalSize - directoryOffset) / 8) {
            throw std::runtime_error("PE data directory count is invalid");
        }
        const std::size_t sectionsOffset = optionalOffset + optionalSize;
        const auto sectionCount = read16(peOffset + 6);
        if (sectionCount == 0 || sectionCount > (bytes.size() - sectionsOffset) / 40) {
            throw std::runtime_error("PE section table is invalid");
        }
        std::size_t imageEnd = read32(optionalOffset + 60);
        if (imageEnd < sectionsOffset + sectionCount * 40 || imageEnd > bytes.size()) {
            throw std::runtime_error("PE header size is invalid");
        }
        for (std::size_t index = 0; index < sectionCount; ++index) {
            const std::size_t section = sectionsOffset + index * 40;
            const std::size_t size = read32(section + 16);
            const std::size_t offset = read32(section + 20);
            if (size == 0) continue;
            if (offset < read32(optionalOffset + 60) || offset > bytes.size() || size > bytes.size() - offset) {
                throw std::runtime_error("PE section data is invalid");
            }
            imageEnd = (std::max)(imageEnd, offset + size);
        }
        // Unlike other PE data directories, SECURITY contains a file offset, not an RVA.
        const std::size_t securityDirectory = optionalOffset + directoryOffset + 4 * 8;
        const std::size_t certificateOffset = read32(securityDirectory);
        const std::size_t certificateSize = read32(securityDirectory + 4);
        if (certificateOffset == 0 && certificateSize == 0) return { bytes.size(), imageEnd, false };
        if (certificateOffset < imageEnd || certificateOffset % 8 != 0 || certificateOffset > bytes.size() ||
            certificateSize < 8 || certificateSize != bytes.size() - certificateOffset) {
            throw std::runtime_error("Authenticode certificate table must be an aligned suffix of the executable");
        }
        std::size_t position = certificateOffset;
        while (position < bytes.size()) {
            if (bytes.size() - position < 8) throw std::runtime_error("Authenticode certificate table is truncated");
            const std::size_t length = read32(position);
            if (length < 8 || length > bytes.size() - position ||
                read16(position + 4) != 0x0200 || read16(position + 6) != 0x0002) {
                throw std::runtime_error("Authenticode WIN_CERTIFICATE record is invalid");
            }
            const std::size_t padding = (8 - length % 8) % 8;
            if (padding > bytes.size() - position - length ||
                !std::all_of(bytes.begin() + position + length, bytes.begin() + position + length + padding,
                    [](std::uint8_t value) { return value == 0; })) {
                throw std::runtime_error("Authenticode certificate alignment padding is invalid");
            }
            position += length + padding;
        }
        return { certificateOffset, imageEnd, true };
    }
}

#endif
