#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <bcrypt.h>
#include <shellapi.h>
#include <shlobj.h>

#include "zstd.h"
#include "../windows/pe_authenticode.h"

#include <algorithm>
#include <array>
#include <charconv>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <regex>
#include <sstream>
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

struct Version {
    std::array<std::string, 3> core;
    std::vector<std::string> prerelease;
};

bool numericIdentifier(const std::string& value) {
    return !value.empty() && value.find_first_not_of("0123456789") == std::string::npos;
}

int compareNumeric(const std::string& left, const std::string& right) {
    if (left.size() != right.size()) return left.size() > right.size() ? 1 : -1;
    return left.compare(right);
}

Version parseVersion(const std::string& value) {
    static const std::regex pattern(
        R"(^v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-([0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*))?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$)");
    std::smatch match;
    if (value.size() > 256 || !std::regex_match(value, match, pattern)) {
        throw std::runtime_error("Application version is not valid semver");
    }
    Version result{{match[1], match[2], match[3]}, {}};
    for (const auto& part : result.core) {
        if (compareNumeric(part, "9007199254740991") > 0) throw std::runtime_error("Application version number is too large");
    }
    if (match[5].matched) {
        std::istringstream input(match[5].str());
        std::string identifier;
        while (std::getline(input, identifier, '.')) {
            if (numericIdentifier(identifier) && identifier.size() > 1 && identifier.front() == '0') {
                throw std::runtime_error("Application prerelease version has a leading zero");
            }
            result.prerelease.push_back(identifier);
        }
    }
    return result;
}

bool newerVersion(const std::string& left, const std::string& right) {
    const auto a = parseVersion(left);
    const auto b = parseVersion(right);
    for (std::size_t index = 0; index < a.core.size(); index++) {
        const int order = compareNumeric(a.core[index], b.core[index]);
        if (order != 0) return order > 0;
    }
    if (a.prerelease.empty() || b.prerelease.empty()) return a.prerelease.empty() && !b.prerelease.empty();
    for (std::size_t index = 0; index < std::min<std::size_t>(a.prerelease.size(), b.prerelease.size()); index++) {
        const auto& x = a.prerelease[index];
        const auto& y = b.prerelease[index];
        const bool xNumeric = numericIdentifier(x);
        const bool yNumeric = numericIdentifier(y);
        const int order = xNumeric != yNumeric ? (xNumeric ? -1 : 1) : xNumeric ? compareNumeric(x, y) : x.compare(y);
        if (order != 0) return order > 0;
    }
    return a.prerelease.size() > b.prerelease.size();
}

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

Container parseContainer(const std::vector<std::uint8_t>& executable) {
    const auto layout = DeskGap::ReadPeAuthenticodeLayout(executable);
    const std::size_t boundary = layout.contentEnd;
    const std::size_t maximumPadding = layout.hasCertificates ? 7 : 0;
    for (std::size_t padding = 0; padding <= maximumPadding && boundary >= sizeof(Footer) + padding; padding++) {
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
                if (runtimeOffset < layout.imageEnd) continue;
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
                    parseVersion(result.appVersion);
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

std::string bundleRecord(const Container& container) {
    std::string result = "DG-BUNDLE-1\n" + container.appVersion + "\n" + container.entry + "\n" +
        hex(container.runtimeSha256) + "\n" + hex(container.applicationSha256) + "\n";
    const auto appendManifest = [&](char section, const std::vector<ManifestEntry>& entries) {
        for (const auto& entry : entries) {
            result += std::string(1, section) + "\t" + hex(entry.sha256) + "\t" + std::to_string(entry.size) + "\t" + entry.path + "\n";
        }
    };
    appendManifest('R', container.runtimeManifest);
    appendManifest('A', container.applicationManifest);
    return result;
}

Container readBundleRecord(const fs::path& file) {
    const DWORD attributes = GetFileAttributesW(file.c_str());
    if (attributes == INVALID_FILE_ATTRIBUTES || (attributes & (FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_DIRECTORY)) != 0 ||
        fs::file_size(file) > kMaximumMetadataBytes) throw std::runtime_error("Invalid installed bundle record");
    const auto bytes = readFile(file);
    std::istringstream input(std::string(bytes.begin(), bytes.end()));
    std::string header, runtimeHash, applicationHash;
    Container result;
    if (!std::getline(input, header) || header != "DG-BUNDLE-1" || !std::getline(input, result.appVersion) ||
        !std::getline(input, result.entry) || !std::getline(input, runtimeHash) || !std::getline(input, applicationHash) ||
        !safeRelativePath(result.entry)) throw std::runtime_error("Invalid installed bundle metadata");
    parseVersion(result.appVersion);
    result.runtimeSha256 = parseHash(runtimeHash);
    result.applicationSha256 = parseHash(applicationHash);
    if (file.stem() != utf8ToWide(hex(result.runtimeSha256))) throw std::runtime_error("Installed bundle runtime hash mismatch");
    const std::string manifest((std::istreambuf_iterator<char>(input)), std::istreambuf_iterator<char>());
    result.runtimeManifest = parseManifest(manifest, 'R');
    result.applicationManifest = parseManifest(manifest, 'A');
    return result;
}

void writeBundleMarker(const fs::path& applicationRoot, const Container& container) {
    const std::string marker = "{\"sha256\":\"" + hex(container.applicationSha256) +
        "\",\"version\":\"" + container.appVersion + "\"}";
    writeTextAtomically(applicationRoot / L"payloads" / utf8ToWide(hex(container.applicationSha256)) / L".deskgap-payload.json", marker);
    writeTextAtomically(applicationRoot / L"bundles" / utf8ToWide(hex(container.runtimeSha256) + ".json"), marker);
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

struct LaunchOptions {
    DWORD waitForPid = 0;
    std::vector<std::wstring> arguments;
};

LaunchOptions parseLaunchOptions() {
    int argumentCount = 0;
    LPWSTR* arguments = CommandLineToArgvW(GetCommandLineW(), &argumentCount);
    if (arguments == nullptr) throw windowsError("CommandLineToArgvW");
    LaunchOptions result;
    try {
        const std::wstring prefix = L"--deskgap-wait-for-pid=";
        for (int index = 1; index < argumentCount; index++) {
            const std::wstring argument = arguments[index];
            if (argument == L"--deskgap-wait-for-pid") throw std::runtime_error("--deskgap-wait-for-pid requires =<pid>");
            if (!argument.starts_with(prefix)) {
                result.arguments.push_back(argument);
                continue;
            }
            if (result.waitForPid != 0) throw std::runtime_error("--deskgap-wait-for-pid may only be specified once");
            DWORD pid = 0;
            const auto value = argument.substr(prefix.size());
            for (const wchar_t character : value) {
                if (character < L'0' || character > L'9' || pid > (MAXDWORD - (character - L'0')) / 10) {
                    throw std::runtime_error("--deskgap-wait-for-pid must be a positive DWORD process ID");
                }
                pid = pid * 10 + (character - L'0');
            }
            if (pid == 0 || pid == GetCurrentProcessId()) {
                throw std::runtime_error("--deskgap-wait-for-pid must name a positive process ID other than this bootstrap");
            }
            result.waitForPid = pid;
        }
    }
    catch (...) {
        LocalFree(arguments);
        throw;
    }
    LocalFree(arguments);
    return result;
}

void waitForPreviousProcess(DWORD pid) {
    if (pid == 0) return;
    Handle process(OpenProcess(SYNCHRONIZE, FALSE, pid));
    if (process.value == nullptr) {
        const DWORD error = GetLastError();
        if (error == ERROR_INVALID_PARAMETER) return; // The previous process has already exited.
        throw std::runtime_error("OpenProcess for --deskgap-wait-for-pid=" + std::to_string(pid) +
            " failed with Windows error " + std::to_string(error));
    }
    const DWORD status = WaitForSingleObject(process.value, INFINITE);
    if (status == WAIT_FAILED) throw windowsError("WaitForSingleObject for --deskgap-wait-for-pid");
    if (status != WAIT_OBJECT_0) throw std::runtime_error("Waiting for the previous process failed with status " + std::to_string(status));
}

void launch(const fs::path& executable, const std::vector<std::wstring>& arguments) {
    std::wstring commandLine = quoteArgument(executable.wstring());
    for (const auto& argument : arguments) commandLine += L" " + quoteArgument(argument);

    STARTUPINFOW startupInfo{sizeof(startupInfo)};
    PROCESS_INFORMATION processInfo{};
    if (!CreateProcessW(executable.c_str(), commandLine.data(), nullptr, nullptr, FALSE, 0, nullptr, nullptr, &startupInfo, &processInfo)) {
        throw windowsError("CreateProcessW");
    }
    CloseHandle(processInfo.hThread);
    CloseHandle(processInfo.hProcess);
}

void run() {
    const auto options = parseLaunchOptions();
    // Wait before taking the installation mutex or changing any installed application state.
    waitForPreviousProcess(options.waitForPid);
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
    const fs::path applicationRoot = programRoot / L"application";
    const fs::path applicationDirectory = applicationRoot / L"payloads" / utf8ToWide(applicationHash);
    fs::path entry = runtimeDirectory / fs::path(utf8ToWide(container.entry));
    try {
        installArchive(container.runtimeArchive, runtimeDirectory, container.runtimeManifest);
        installArchive(container.applicationArchive, applicationDirectory, container.applicationManifest, true);
        writeBundleMarker(applicationRoot, container);
        const fs::path bundles = applicationRoot / L"bundles";
        writeTextAtomically(bundles / utf8ToWide(runtimeHash + ".bundle"), bundleRecord(container));

        // A newer full package must carry its runtime with it, even when an old launcher is reopened.
        // Records are published only after extraction; every selected file is reverified before launch.
        std::string selectedVersion = container.appVersion;
        for (const auto& record : fs::directory_iterator(bundles)) {
            if (record.path().extension() != L".bundle") continue;
            try {
                const auto candidate = readBundleRecord(record.path());
                if (!newerVersion(candidate.appVersion, selectedVersion)) continue;
                const fs::path candidateRuntime = programRoot / L"runtime" / utf8ToWide(hex(candidate.runtimeSha256));
                const fs::path candidateApplication = applicationRoot / L"payloads" / utf8ToWide(hex(candidate.applicationSha256));
                const fs::path candidateEntry = candidateRuntime / fs::path(utf8ToWide(candidate.entry));
                if (!validateDirectory(candidateRuntime, candidate.runtimeManifest) ||
                    !validateDirectory(candidateApplication, candidate.applicationManifest, true) ||
                    !fs::is_regular_file(candidateEntry)) continue;
                writeBundleMarker(applicationRoot, candidate);
                entry = candidateEntry;
                selectedVersion = candidate.appVersion;
            }
            catch (const std::exception& error) {
                const std::string message = "DeskGap ignored an invalid installed bundle: " + std::string(error.what()) + "\n";
                OutputDebugStringA(message.c_str());
            }
        }
    }
    catch (...) {
        ReleaseMutex(mutex.value);
        throw;
    }
    ReleaseMutex(mutex.value);

    if (!fs::is_regular_file(entry)) throw std::runtime_error("Extracted runtime entry does not exist");
    launch(entry, options.arguments);
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