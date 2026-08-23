#include "clipboard.hpp"
#include "native_image.hpp"
#include "util/wstring_utf8.h"

#include <Windows.h>
#include <cstring>

namespace {
    class ClipboardScope {
    public:
        ClipboardScope(): opened(OpenClipboard(nullptr) != FALSE) {}
        ~ClipboardScope() { if (opened) CloseClipboard(); }
        explicit operator bool() const { return opened; }
    private:
        bool opened;
    };

    bool SetClipboardBytes(UINT format, const void* bytes, size_t size) {
        HGLOBAL memory = GlobalAlloc(GMEM_MOVEABLE, size);
        if (memory == nullptr) return false;
        void* destination = GlobalLock(memory);
        if (destination == nullptr) {
            GlobalFree(memory);
            return false;
        }
        std::memcpy(destination, bytes, size);
        GlobalUnlock(memory);
        if (SetClipboardData(format, memory) == nullptr) {
            GlobalFree(memory);
            return false;
        }
        return true;
    }
}

std::string DeskGap::Clipboard::ReadText() {
    ClipboardScope clipboard;
    if (!clipboard) return "";
    HANDLE data = GetClipboardData(CF_UNICODETEXT);
    if (data == nullptr) return "";
    const wchar_t* text = static_cast<const wchar_t*>(GlobalLock(data));
    if (text == nullptr) return "";
    std::string result = WStringToUTF8(text);
    GlobalUnlock(data);
    return result;
}

bool DeskGap::Clipboard::WriteText(const std::string& text) {
    ClipboardScope clipboard;
    if (!clipboard || !EmptyClipboard()) return false;
    std::wstring wideText = UTF8ToWString(text.c_str());
    return SetClipboardBytes(CF_UNICODETEXT, wideText.c_str(), (wideText.size() + 1) * sizeof(wchar_t));
}

bool DeskGap::Clipboard::WriteImage(const std::vector<uint8_t>& png) {
    if (png.empty()) return false;
    NativeImage image = NativeImage::CreateFromBuffer(png.data(), png.size());
    const NativeImage::Representation* representation = image.GetRepresentation();
    if (representation == nullptr) return false;

    ClipboardScope clipboard;
    if (!clipboard || !EmptyClipboard()) return false;

    UINT pngFormat = RegisterClipboardFormatW(L"PNG");
    bool wrotePng = pngFormat != 0 && SetClipboardBytes(pngFormat, png.data(), png.size());

    BITMAPV5HEADER header { };
    header.bV5Size = sizeof(header);
    header.bV5Width = representation->pixelWidth;
    header.bV5Height = -representation->pixelHeight;
    header.bV5Planes = 1;
    header.bV5BitCount = 32;
    header.bV5Compression = BI_BITFIELDS;
    header.bV5SizeImage = static_cast<DWORD>(representation->pixels.size());
    header.bV5RedMask = 0x00ff0000;
    header.bV5GreenMask = 0x0000ff00;
    header.bV5BlueMask = 0x000000ff;
    header.bV5AlphaMask = 0xff000000;
    header.bV5CSType = LCS_sRGB;

    std::vector<uint8_t> dib(sizeof(header) + representation->pixels.size());
    std::memcpy(dib.data(), &header, sizeof(header));
    uint8_t* pixels = dib.data() + sizeof(header);
    for (size_t index = 0; index < representation->pixels.size(); index += 4) {
        pixels[index] = representation->pixels[index + 2];
        pixels[index + 1] = representation->pixels[index + 1];
        pixels[index + 2] = representation->pixels[index];
        pixels[index + 3] = representation->pixels[index + 3];
    }
    bool wroteBitmap = SetClipboardBytes(CF_DIBV5, dib.data(), dib.size());
    return wrotePng || wroteBitmap;
}
