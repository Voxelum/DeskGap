#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <bcrypt.h>
#include <shellapi.h>
#include <shlobj.h>

#include "zstd.h"

#include <algorithm>
#include <array>
#include <charconv>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <span>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace {
namespace fs = std::filesystem;

constexpr std::array<char, 8> kMagic{'D', 'G', 'C', 'L', 'K', '0', '0', '1'};
constexpr std::uint32_t kFormatVersion = 1;
constexpr std::uint64_t kMaximumExecutableBytes = 512ULL * 1024 * 1024;
constexpr std::uint64_t kMaximumArchiveBytes = 256ULL * 1024 * 1024;
constexpr std::uint64_t kMaximumExpandedBytes = 1024ULL * 1024 * 1024;
constexpr std::uint32_t kMaximumMetadataBytes = 64U * 1024 * 1024;
constexpr std::size_t kMaximumManifestEntries = 100'000;

#pragma pack(push, 1)
struct Footer {
    char magic[8];
    std::uint32_t version;
    std::uint32_t appNameSize;
    std::uint32_t entrySize;
    std::uint32_t appVersionSize;
    std::uint32_t manifestSize;
    std::uint64_t runtimeSize;
    std::uint64_t applicationSize;
    std::uint8_t runtimeSha256[32];
    std::uint8_t applicationSha256[32];
};
#pragma pack(pop)

static_assert(sizeof(Footer) == 108);

struct Handle {
    HANDLE value = INVALID_HANDLE_VALUE;
    Handle() = default;
    explicit Handle(HANDLE value) : value(value) {}
    Handle(const Handle&) = delete;
    Handle& operator=(const Handle&) = delete;
    Handle(Handle&& other) noexcept : value(other.value) { other.value = INVALID_HANDLE_VALUE; }
    ~Handle() { if (value != INVALID_HANDLE_VALUE && value != nullptr) CloseHandle(value); }
};

struct ManifestEntry {
    std::array<std::uint8_t, 32> sha256;
    std::uint64_t size;
    std::string path;
};

struct Container {
    std::string appName;
    std::string appVersion;
    std::string entry;
    std::vector<std::uint8_t> runtimeArchive;
    std::vector<std::uint8_t> applicationArchive;
    std::array<std::uint8_t, 32> runtimeSha256;
    std::array<std::uint8_t, 32> applicationSha256;
    std::vector<ManifestEntry> runtimeManifest;
    std::vector<ManifestEntry> applicationManifest;
};

std::runtime_error windowsError(const char* operation) {
    return std::runtime_error(std::string(operation) + " failed with Windows error " + std::to_string(GetLastError()));
}

std::wstring utf8ToWide(const std::string& value) {
    if (value.empty()) return {};
    const int length = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), nullptr, 0);
    if (length == 0) throw windowsError("MultiByteToWideChar");
    std::wstring result(length, L'\0');
    if (MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), result.data(), length) == 0) {
        throw windowsError("MultiByteToWideChar");
    }
    return result;
}

std::wstring executablePath() {
    std::wstring result(1024, L'\0');
    while (true) {
        const DWORD length = GetModuleFileNameW(nullptr, result.data(), static_cast<DWORD>(result.size()));
        if (length == 0) throw windowsError("GetModuleFileNameW");
        if (length < result.size() - 1) {
            result.resize(length);
            return result;
        }
        result.resize(result.size() * 2);
    }
}

std::vector<std::uint8_t> readFile(const fs::path& filePath) {
    std::ifstream input(filePath, std::ios::binary | std::ios::ate);
    if (!input) throw std::runtime_error("Cannot open click-to-run executable");
    const auto end = input.tellg();
    if (end < 0 || static_cast<std::uint64_t>(end) > kMaximumExecutableBytes) {
        throw std::runtime_error("Click-to-run executable is too large");
    }
    std::vector<std::uint8_t> result(static_cast<std::size_t>(end));
    input.seekg(0);
    if (!result.empty() && !input.read(reinterpret_cast<char*>(result.data()), result.size())) {
        throw std::runtime_error("Cannot read click-to-run executable");
    }
    return result;
}

std::array<std::uint8_t, 32> sha256(std::span<const std::uint8_t> bytes) {
    BCRYPT_ALG_HANDLE algorithm = nullptr;
    BCRYPT_HASH_HANDLE hash = nullptr;
    DWORD objectSize = 0;
    DWORD resultSize = 0;
    if (BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) < 0 ||
        BCryptGetProperty(algorithm, BCRYPT_OBJECT_LENGTH, reinterpret_cast<PUCHAR>(&objectSize), sizeof(objectSize), &resultSize, 0) < 0) {
        if (algorithm != nullptr) BCryptCloseAlgorithmProvider(algorithm, 0);
        throw std::runtime_error("Cannot initialize SHA-256");
    }
    std::vector<std::uint8_t> object(objectSize);
    std::array<std::uint8_t, 32> digest{};
    if (BCryptCreateHash(algorithm, &hash, object.data(), objectSize, nullptr, 0, 0) < 0) {
        BCryptCloseAlgorithmProvider(algorithm, 0);
        throw std::runtime_error("Cannot create SHA-256 hash");
    }
    std::size_t offset = 0;
    while (offset < bytes.size()) {
        const ULONG size = static_cast<ULONG>(std::min<std::size_t>(bytes.size() - offset, 1024 * 1024));
        if (BCryptHashData(hash, const_cast<PUCHAR>(bytes.data() + offset), size, 0) < 0) {
            BCryptDestroyHash(hash);
            BCryptCloseAlgorithmProvider(algorithm, 0);
            throw std::runtime_error("Cannot update SHA-256 hash");
        }
        offset += size;
    }
    const auto status = BCryptFinishHash(hash, digest.data(), static_cast<ULONG>(digest.size()), 0);
    BCryptDestroyHash(hash);
    BCryptCloseAlgorithmProvider(algorithm, 0);
    if (status < 0) throw std::runtime_error("Cannot finish SHA-256 hash");
    return digest;
}

std::array<std::uint8_t, 32> sha256File(const fs::path& filePath) {
    return sha256(readFile(filePath));
}

std::string hex(std::span<const std::uint8_t> bytes) {
    constexpr char digits[] = "0123456789abcdef";
    std::string result(bytes.size() * 2, '0');
    for (std::size_t index = 0; index < bytes.size(); index++) {
        result[index * 2] = digits[bytes[index] >> 4];
        result[index * 2 + 1] = digits[bytes[index] & 0x0f];
    }
    return result;
}

std::string randomToken() {
    std::array<std::uint8_t, 16> bytes{};
    if (BCryptGenRandom(nullptr, bytes.data(), static_cast<ULONG>(bytes.size()), BCRYPT_USE_SYSTEM_PREFERRED_RNG) < 0) {
        throw std::runtime_error("Cannot generate a secure staging name");
    }
    return hex(bytes);
}

std::array<std::uint8_t, 32> parseHash(const std::string& value) {
    if (value.size() != 64) throw std::runtime_error("Manifest contains an invalid SHA-256 digest");
    std::array<std::uint8_t, 32> result{};
    for (std::size_t index = 0; index < result.size(); index++) {
        const auto decode = [](char character) -> int {
            if (character >= '0' && character <= '9') return character - '0';
            if (character >= 'a' && character <= 'f') return character - 'a' + 10;
            if (character >= 'A' && character <= 'F') return character - 'A' + 10;
            return -1;
        };
        const int high = decode(value[index * 2]);
        const int low = decode(value[index * 2 + 1]);
        if (high < 0 || low < 0) throw std::runtime_error("Manifest contains an invalid SHA-256 digest");
        result[index] = static_cast<std::uint8_t>((high << 4) | low);
    }
    return result;
}

bool safeComponent(const std::string& value) {
    if (value.empty() || value == "." || value == ".." || value.back() == '.' || value.back() == ' ') return false;
    for (const unsigned char character : value) {
        if (character < 0x20 || character == '\\' || character == '/' || character == ':' || character == '*' ||
            character == '?' || character == '"' || character == '<' || character == '>' || character == '|') return false;
    }
    std::string stem = value.substr(0, value.find('.'));
    std::transform(stem.begin(), stem.end(), stem.begin(), [](unsigned char character) { return static_cast<char>(std::tolower(character)); });
    static const std::unordered_set<std::string> reserved{
        "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
        "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
    };
    return !reserved.contains(stem);
}

bool safeRelativePath(const std::string& value) {
    if (value.empty() || value.front() == '/' || value.find('\\') != std::string::npos) return false;
    std::size_t start = 0;
    while (start <= value.size()) {
        const auto end = value.find('/', start);
        if (!safeComponent(value.substr(start, end == std::string::npos ? value.size() - start : end - start))) return false;
        if (end == std::string::npos) break;
        start = end + 1;
    }
    return true;
}

std::vector<ManifestEntry> parseManifest(const std::string& manifest, char section) {
    std::vector<ManifestEntry> result;
    std::unordered_set<std::string> paths;
    std::size_t start = 0;
    while (start < manifest.size()) {
        const auto end = manifest.find('\n', start);
        if (end == std::string::npos) throw std::runtime_error("Click-to-run manifest is truncated");
        const std::string line = manifest.substr(start, end - start);
        start = end + 1;
        if (line.size() < 4 || line[0] != section || line[1] != '\t') continue;
        const auto hashEnd = line.find('\t', 2);
        const auto sizeEnd = hashEnd == std::string::npos ? std::string::npos : line.find('\t', hashEnd + 1);
        if (hashEnd == std::string::npos || sizeEnd == std::string::npos) throw std::runtime_error("Click-to-run manifest is invalid");
        std::uint64_t size = 0;
        const auto sizeText = line.substr(hashEnd + 1, sizeEnd - hashEnd - 1);
        const auto parsed = std::from_chars(sizeText.data(), sizeText.data() + sizeText.size(), size);
        const std::string relativePath = line.substr(sizeEnd + 1);
        if (parsed.ec != std::errc{} || parsed.ptr != sizeText.data() + sizeText.size() || !safeRelativePath(relativePath) ||
            !paths.insert(relativePath).second) {
            throw std::runtime_error("Click-to-run manifest contains an invalid file entry");
        }
        std::string lowerPath = relativePath;
        std::transform(lowerPath.begin(), lowerPath.end(), lowerPath.begin(),
            [](unsigned char character) { return static_cast<char>(std::tolower(character)); });
        if (section == 'A' && lowerPath == ".deskgap-payload.json") {
            throw std::runtime_error("Application manifest contains the reserved payload marker");
        }
        result.push_back({parseHash(line.substr(2, hashEnd - 2)), size, relativePath});
        if (result.size() > kMaximumManifestEntries) throw std::runtime_error("Click-to-run manifest contains too many files");
    }
    if (result.empty()) throw std::runtime_error("Click-to-run manifest section is empty");
    return result;
}

std::uint16_t readUInt16(const std::vector<std::uint8_t>& bytes, std::size_t offset) {
    if (offset + sizeof(std::uint16_t) > bytes.size()) throw std::runtime_error("PE header is truncated");
    std::uint16_t result = 0;
    std::memcpy(&result, bytes.data() + offset, sizeof(result));
    return result;
}

std::uint32_t readUInt32(const std::vector<std::uint8_t>& bytes, std::size_t offset) {
    if (offset + sizeof(std::uint32_t) > bytes.size()) throw std::runtime_error("PE header is truncated");
    std::uint32_t result = 0;
    std::memcpy(&result, bytes.data() + offset, sizeof(result));
    return result;
}

std::size_t signedContentBoundary(const std::vector<std::uint8_t>& executable) {
    if (executable.size() < 0x40 || executable[0] != 'M' || executable[1] != 'Z') {
        throw std::runtime_error("Click-to-run executable is not a PE file");
    }
    const std::size_t peOffset = readUInt32(executable, 0x3c);
    if (peOffset + 24 > executable.size() || std::memcmp(executable.data() + peOffset, "PE\0\0", 4) != 0) {
        throw std::runtime_error("Click-to-run PE header is invalid");
    }
    const std::size_t optionalOffset = peOffset + 24;
    const std::size_t optionalSize = readUInt16(executable, peOffset + 20);
    if (optionalOffset + optionalSize > executable.size()) throw std::runtime_error("Click-to-run optional PE header is truncated");
    const std::uint16_t magic = readUInt16(executable, optionalOffset);
    const std::size_t directoryOffset = magic == 0x20b ? 112 : magic == 0x10b ? 96 : 0;
    const std::size_t countOffset = magic == 0x20b ? 108 : magic == 0x10b ? 92 : 0;
    if (directoryOffset == 0 || optionalSize < directoryOffset + 5 * 8 || readUInt32(executable, optionalOffset + countOffset) < 5) {
        throw std::runtime_error("Click-to-run PE data directories are invalid");
    }
    const std::size_t securityDirectory = optionalOffset + directoryOffset + 4 * 8;
    const std::uint32_t certificateOffset = readUInt32(executable, securityDirectory);
    const std::uint32_t certificateSize = readUInt32(executable, securityDirectory + 4);
    if (certificateOffset == 0 && certificateSize == 0) return executable.size();
    if (certificateOffset == 0 || certificateSize < 8 ||
        static_cast<std::uint64_t>(certificateOffset) + certificateSize != executable.size()) {
        throw std::runtime_error("Click-to-run Authenticode certificate table is invalid");
    }
    return certificateOffset;
}

Container parseContainer(const std::vector<std::uint8_t>& executable) {
    const std::size_t boundary = signedContentBoundary(executable);
    for (std::size_t padding = 0; padding <= 7 && boundary >= sizeof(Footer) + padding; padding++) {
        const std::size_t offset = boundary - sizeof(Footer) - padding;
        if (!std::all_of(executable.begin() + offset + sizeof(Footer), executable.begin() + boundary,
            [](std::uint8_t value) { return value == 0; })) continue;
        if (std::memcmp(executable.data() + offset, kMagic.data(), kMagic.size()) == 0) {
            Footer footer{};
            std::memcpy(&footer, executable.data() + offset, sizeof(footer));
            const std::uint64_t metadataSize = static_cast<std::uint64_t>(footer.appNameSize) + footer.entrySize +
                footer.appVersionSize + footer.manifestSize;
            const std::uint64_t suffixSize = footer.runtimeSize + footer.applicationSize + metadataSize;
            if (footer.version == kFormatVersion && footer.runtimeSize > 0 && footer.applicationSize > 0 &&
                footer.runtimeSize <= kMaximumArchiveBytes && footer.applicationSize <= kMaximumArchiveBytes &&
                metadataSize <= kMaximumMetadataBytes && suffixSize <= offset) {
                const std::size_t runtimeOffset = offset - static_cast<std::size_t>(suffixSize);
                const std::size_t applicationOffset = runtimeOffset + static_cast<std::size_t>(footer.runtimeSize);
                std::size_t metadataOffset = applicationOffset + static_cast<std::size_t>(footer.applicationSize);
                Container result;
                result.runtimeArchive.assign(executable.begin() + runtimeOffset, executable.begin() + applicationOffset);
                result.applicationArchive.assign(executable.begin() + applicationOffset, executable.begin() + metadataOffset);
                const auto readString = [&](std::uint32_t size) {
                    const std::string value(reinterpret_cast<const char*>(executable.data() + metadataOffset), size);
                    metadataOffset += size;
                    return value;
                };
                result.appName = readString(footer.appNameSize);
                result.entry = readString(footer.entrySize);
                result.appVersion = readString(footer.appVersionSize);
                const std::string manifest = readString(footer.manifestSize);
                std::copy(std::begin(footer.runtimeSha256), std::end(footer.runtimeSha256), result.runtimeSha256.begin());
                std::copy(std::begin(footer.applicationSha256), std::end(footer.applicationSha256), result.applicationSha256.begin());
                if (safeComponent(result.appName) && safeRelativePath(result.entry) &&
                    sha256(result.runtimeArchive) == result.runtimeSha256 && sha256(result.applicationArchive) == result.applicationSha256) {
                    result.runtimeManifest = parseManifest(manifest, 'R');
                    result.applicationManifest = parseManifest(manifest, 'A');
                    return result;
                }
            }
        }
    }
    throw std::runtime_error("This executable does not contain a valid DeskGap click-to-run payload");
}

std::uint64_t expectedExpandedSize(const std::vector<ManifestEntry>& manifest) {
    std::uint64_t result = 0;
    for (const auto& entry : manifest) {
        if (entry.size > kMaximumExpandedBytes - result) throw std::runtime_error("Click-to-run payload is too large");
        result += entry.size;
    }
    return result;
}

std::vector<std::uint8_t> decompress(const std::vector<std::uint8_t>& archive, std::uint64_t expectedSize, std::size_t entryCount) {
    const std::uint64_t maximumSize = expectedSize + std::min<std::uint64_t>(entryCount * 2048ULL + 1024 * 1024ULL, 64ULL * 1024 * 1024);
    if (maximumSize > kMaximumExpandedBytes) throw std::runtime_error("Expanded click-to-run payload is too large");
    ZSTD_DStream* stream = ZSTD_createDStream();
    if (stream == nullptr) throw std::runtime_error("Cannot create Zstd decoder");
    if (ZSTD_isError(ZSTD_initDStream(stream))) {
        ZSTD_freeDStream(stream);
        throw std::runtime_error("Cannot initialize Zstd decoder");
    }
    std::vector<std::uint8_t> result;
    result.reserve(static_cast<std::size_t>(std::min<std::uint64_t>(maximumSize, 256ULL * 1024 * 1024)));
    std::vector<std::uint8_t> output(ZSTD_DStreamOutSize());
    ZSTD_inBuffer input{archive.data(), archive.size(), 0};
    std::size_t remaining = 1;
    while (input.pos < input.size || remaining != 0) {
        ZSTD_outBuffer target{output.data(), output.size(), 0};
        const auto previousInput = input.pos;
        remaining = ZSTD_decompressStream(stream, &target, &input);
        if (ZSTD_isError(remaining)) {
            const std::string message = ZSTD_getErrorName(remaining);
            ZSTD_freeDStream(stream);
            throw std::runtime_error("Cannot decompress payload: " + message);
        }
        if (result.size() + target.pos > maximumSize) {
            ZSTD_freeDStream(stream);
            throw std::runtime_error("Expanded payload exceeds its manifest size");
        }
        result.insert(result.end(), output.begin(), output.begin() + target.pos);
        if (input.pos == previousInput && target.pos == 0) {
            ZSTD_freeDStream(stream);
            throw std::runtime_error("Zstd payload is truncated");
        }
    }
    ZSTD_freeDStream(stream);
    return result;
}

std::uint64_t parseTarNumber(const std::uint8_t* value, std::size_t size) {
    while (size > 0 && (*value == ' ' || *value == '\0')) { value++; size--; }
    std::uint64_t result = 0;
    while (size > 0 && *value >= '0' && *value <= '7') {
        if (result > (UINT64_MAX - 7) / 8) throw std::runtime_error("Tar number overflows");
        result = result * 8 + (*value - '0');
        value++;
        size--;
    }
    return result;
}

std::string tarString(const std::uint8_t* value, std::size_t size) {
    const auto end = std::find(value, value + size, 0);
    return std::string(reinterpret_cast<const char*>(value), reinterpret_cast<const char*>(end));
}

void verifyTarHeader(const std::uint8_t* header) {
    std::uint64_t actual = 0;
    for (std::size_t index = 0; index < 512; index++) actual += index >= 148 && index < 156 ? 32 : header[index];
    if (actual != parseTarNumber(header + 148, 8)) throw std::runtime_error("Tar header checksum mismatch");
}

std::string paxPath(std::span<const std::uint8_t> data) {
    std::size_t offset = 0;
    std::string result;
    while (offset < data.size()) {
        const auto space = std::find(data.begin() + offset, data.end(), static_cast<std::uint8_t>(' '));
        if (space == data.end()) throw std::runtime_error("PAX header is invalid");
        std::size_t recordSize = 0;
        const std::string sizeText(reinterpret_cast<const char*>(data.data() + offset), space - (data.begin() + offset));
        const auto parsed = std::from_chars(sizeText.data(), sizeText.data() + sizeText.size(), recordSize);
        if (sizeText.empty() || parsed.ec != std::errc{} || parsed.ptr != sizeText.data() + sizeText.size() ||
            recordSize < sizeText.size() + 3 || recordSize > data.size() - offset || data[offset + recordSize - 1] != '\n') {
            throw std::runtime_error("PAX header is invalid");
        }
        const std::size_t valueSize = recordSize - sizeText.size() - 2;
        const std::string record(reinterpret_cast<const char*>(&*space + 1), valueSize);
        if (record.starts_with("path=")) result = record.substr(5);
        offset += recordSize;
    }
    return result;
}

void extractArchive(const std::vector<std::uint8_t>& archive, const fs::path& destination, const std::vector<ManifestEntry>& manifest) {
    const auto tar = decompress(archive, expectedExpandedSize(manifest), manifest.size());
    std::unordered_map<std::string, const ManifestEntry*> expected;
    for (const auto& entry : manifest) expected.emplace(entry.path, &entry);
    std::unordered_set<std::string> extracted;
    std::string pendingPaxPath;
    std::size_t offset = 0;
    while (offset + 512 <= tar.size()) {
        const auto* header = tar.data() + offset;
        const bool empty = std::all_of(header, header + 512, [](std::uint8_t value) { return value == 0; });
        if (empty) break;
        verifyTarHeader(header);
        const std::uint64_t size = parseTarNumber(header + 124, 12);
        const std::uint64_t paddedSize = (size + 511) & ~511ULL;
        if (size > tar.size() || offset + 512ULL + paddedSize > tar.size()) throw std::runtime_error("Tar entry is truncated");
        std::string name = tarString(header, 100);
        const std::string prefix = tarString(header + 345, 155);
        if (!prefix.empty()) name = prefix + '/' + name;
        const char type = static_cast<char>(header[156]);
        const auto body = std::span<const std::uint8_t>(header + 512, static_cast<std::size_t>(size));
        if (type == 'x') {
            pendingPaxPath = paxPath(body);
        }
        else {
            if (!pendingPaxPath.empty()) {
                name = pendingPaxPath;
                pendingPaxPath.clear();
            }
            if (type != '\0' && type != '0') throw std::runtime_error("Payload contains an unsupported tar entry type");
            if (!safeRelativePath(name)) throw std::runtime_error("Payload contains an unsafe path");
            const auto found = expected.find(name);
            if (found == expected.end() || !extracted.insert(name).second || found->second->size != size || sha256(body) != found->second->sha256) {
                throw std::runtime_error("Payload file does not match its signed manifest: " + name);
            }
            const fs::path outputPath = destination / fs::path(utf8ToWide(name));
            fs::create_directories(outputPath.parent_path());
            for (fs::path current = outputPath.parent_path(); ; current = current.parent_path()) {
                const DWORD attributes = GetFileAttributesW(current.c_str());
                if (attributes == INVALID_FILE_ATTRIBUTES || (attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0) {
                    throw std::runtime_error("Payload extraction path contains a reparse point");
                }
                if (current == destination) break;
            }
            std::ofstream output(outputPath, std::ios::binary | std::ios::trunc);
            if (!output || (size > 0 && !output.write(reinterpret_cast<const char*>(body.data()), static_cast<std::streamsize>(body.size())))) {
                throw std::runtime_error("Cannot write extracted payload file");
            }
        }
        offset += 512 + static_cast<std::size_t>(paddedSize);
    }
    if (extracted.size() != manifest.size()) throw std::runtime_error("Payload does not contain every manifest file");
}

bool validateDirectory(const fs::path& root, const std::vector<ManifestEntry>& manifest, bool allowPayloadMarker = false) {
    try {
        const DWORD rootAttributes = GetFileAttributesW(root.c_str());
        if (rootAttributes == INVALID_FILE_ATTRIBUTES || (rootAttributes & FILE_ATTRIBUTE_DIRECTORY) == 0 ||
            (rootAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0) return false;
        std::unordered_map<std::string, const ManifestEntry*> expected;
        for (const auto& entry : manifest) expected.emplace(entry.path, &entry);
        for (const auto& item : fs::recursive_directory_iterator(root)) {
            const DWORD attributes = GetFileAttributesW(item.path().c_str());
            if (attributes == INVALID_FILE_ATTRIBUTES || (attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0) return false;
            if ((attributes & FILE_ATTRIBUTE_DIRECTORY) != 0) continue;
            if ((attributes & FILE_ATTRIBUTE_DEVICE) != 0) return false;
            const std::u8string relative = fs::relative(item.path(), root).generic_u8string();
            const std::string name(reinterpret_cast<const char*>(relative.data()), relative.size());
            std::string lowerName = name;
            std::transform(lowerName.begin(), lowerName.end(), lowerName.begin(),
                [](unsigned char character) { return static_cast<char>(std::tolower(character)); });
            if (allowPayloadMarker && lowerName == ".deskgap-payload.json") continue;
            const auto found = expected.find(name);
            if (found == expected.end() || item.file_size() != found->second->size || sha256File(item.path()) != found->second->sha256) return false;
            expected.erase(found);
        }
        return expected.empty();
    }
    catch (...) {
        return false;
    }
}

void installArchive(const std::vector<std::uint8_t>& archive, const fs::path& target, const std::vector<ManifestEntry>& manifest,
    bool allowPayloadMarker = false) {
    if (validateDirectory(target, manifest, allowPayloadMarker)) return;
    fs::create_directories(target.parent_path());
    const fs::path temporary = target.parent_path() / utf8ToWide(".extract-" + randomToken());
    const fs::path backup = target.parent_path() / utf8ToWide(".replaced-" + randomToken());
    bool movedTarget = false;
    try {
        if (!fs::create_directory(temporary)) throw std::runtime_error("Cannot reserve payload staging directory");
        extractArchive(archive, temporary, manifest);
        if (!validateDirectory(temporary, manifest, allowPayloadMarker)) throw std::runtime_error("Extracted payload failed verification");
        if (validateDirectory(target, manifest, allowPayloadMarker)) {
            fs::remove_all(temporary);
            return;
        }
        if (fs::exists(target)) {
            fs::rename(target, backup);
            movedTarget = true;
        }
        fs::rename(temporary, target);
        if (movedTarget) fs::remove_all(backup);
    }
    catch (...) {
        fs::remove_all(temporary);
        if (movedTarget && fs::exists(backup) && !fs::exists(target)) {
            fs::rename(backup, target);
        }
        throw;
    }
}

fs::path localAppData() {
    PWSTR value = nullptr;
    if (SHGetKnownFolderPath(FOLDERID_LocalAppData, KF_FLAG_CREATE, nullptr, &value) != S_OK) {
        throw std::runtime_error("Cannot locate Local AppData");
    }
    const fs::path result(value);
    CoTaskMemFree(value);
    return result;
}

void writeTextAtomically(const fs::path& target, const std::string& value) {
    fs::create_directories(target.parent_path());
    const fs::path temporary = target.wstring() + L"." + std::to_wstring(GetCurrentProcessId()) + L".tmp";
    {
        std::ofstream output(temporary, std::ios::binary | std::ios::trunc);
        if (!output || !output.write(value.data(), static_cast<std::streamsize>(value.size()))) throw std::runtime_error("Cannot write activation file");
    }
    if (!MoveFileExW(temporary.c_str(), target.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
        fs::remove(temporary);
        throw windowsError("MoveFileExW");
    }
}

std::wstring quoteArgument(const std::wstring& value) {
    if (value.empty()) return L"\"\"";
    if (value.find_first_of(L" \t\"") == std::wstring::npos) return value;
    std::wstring result = L"\"";
    std::size_t slashes = 0;
    for (const wchar_t character : value) {
        if (character == L'\\') {
            slashes++;
        }
        else if (character == L'\"') {
            result.append(slashes * 2 + 1, L'\\');
            result.push_back(character);
            slashes = 0;
        }
        else {
            result.append(slashes, L'\\');
            slashes = 0;
            result.push_back(character);
        }
    }
    result.append(slashes * 2, L'\\');
    result.push_back(L'\"');
    return result;
}

void launch(const fs::path& executable) {
    int argumentCount = 0;
    LPWSTR* arguments = CommandLineToArgvW(GetCommandLineW(), &argumentCount);
    if (arguments == nullptr) throw windowsError("CommandLineToArgvW");
    std::wstring commandLine = quoteArgument(executable.wstring());
    for (int index = 1; index < argumentCount; index++) commandLine += L" " + quoteArgument(arguments[index]);
    LocalFree(arguments);

    STARTUPINFOW startupInfo{sizeof(startupInfo)};
    PROCESS_INFORMATION processInfo{};
    if (!CreateProcessW(executable.c_str(), commandLine.data(), nullptr, nullptr, FALSE, 0, nullptr, nullptr, &startupInfo, &processInfo)) {
        throw windowsError("CreateProcessW");
    }
    CloseHandle(processInfo.hThread);
    CloseHandle(processInfo.hProcess);
}

void run() {
    const Container container = parseContainer(readFile(executablePath()));
    const std::string runtimeHash = hex(container.runtimeSha256);
    const std::string applicationHash = hex(container.applicationSha256);
    const fs::path programRoot = localAppData() / L"Programs" / utf8ToWide(container.appName);

    std::wstring normalizedAppName = utf8ToWide(container.appName);
    CharLowerBuffW(normalizedAppName.data(), static_cast<DWORD>(normalizedAppName.size()));
    const auto appIdentityHash = sha256(std::span<const std::uint8_t>(
        reinterpret_cast<const std::uint8_t*>(normalizedAppName.data()), normalizedAppName.size() * sizeof(wchar_t)));
    const std::wstring mutexName = L"Local\\DeskGapClick-" + utf8ToWide(hex(appIdentityHash).substr(0, 32));
    Handle mutex(CreateMutexW(nullptr, FALSE, mutexName.c_str()));
    if (mutex.value == nullptr || mutex.value == INVALID_HANDLE_VALUE) throw windowsError("CreateMutexW");
    if (WaitForSingleObject(mutex.value, INFINITE) != WAIT_OBJECT_0) throw windowsError("WaitForSingleObject");

    const fs::path runtimeDirectory = programRoot / L"runtime" / utf8ToWide(runtimeHash);
    const fs::path applicationDirectory = programRoot / L"application" / L"payloads" / utf8ToWide(applicationHash);
    try {
        installArchive(container.runtimeArchive, runtimeDirectory, container.runtimeManifest);
        installArchive(container.applicationArchive, applicationDirectory, container.applicationManifest, true);
        writeTextAtomically(applicationDirectory / L".deskgap-payload.json",
            "{\"sha256\":\"" + applicationHash + "\",\"version\":\"" + container.appVersion + "\"}");
        writeTextAtomically(programRoot / L"application" / L"active.json",
            "{\"sha256\":\"" + applicationHash + "\",\"version\":\"" + container.appVersion + "\"}");
    }
    catch (...) {
        ReleaseMutex(mutex.value);
        throw;
    }
    ReleaseMutex(mutex.value);

    const fs::path entry = runtimeDirectory / fs::path(utf8ToWide(container.entry));
    if (!fs::is_regular_file(entry)) throw std::runtime_error("Extracted runtime entry does not exist");
    launch(entry);
}
}

int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
    try {
        run();
        return 0;
    }
    catch (const std::exception& error) {
        MessageBoxA(nullptr, error.what(), "DeskGap click-to-run", MB_OK | MB_ICONERROR);
        return 1;
    }
}