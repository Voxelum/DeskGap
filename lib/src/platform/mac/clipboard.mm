#import <AppKit/AppKit.h>

#include "clipboard.hpp"
#include "util/string_convert.h"

std::string DeskGap::Clipboard::ReadText() {
    NSString* text = [[NSPasteboard generalPasteboard] stringForType:NSPasteboardTypeString];
    return text == nil ? std::string() : CXXStr(text);
}

bool DeskGap::Clipboard::WriteText(const std::string& text) {
    NSPasteboard* pasteboard = [NSPasteboard generalPasteboard];
    [pasteboard clearContents];
    return [pasteboard setString:NSStr(text) forType:NSPasteboardTypeString];
}

bool DeskGap::Clipboard::WriteImage(const std::vector<uint8_t>& png) {
    if (png.empty()) return false;
    NSData* data = [NSData dataWithBytes:png.data() length:png.size()];
    NSPasteboard* pasteboard = [NSPasteboard generalPasteboard];
    [pasteboard clearContents];
    return [pasteboard setData:data forType:NSPasteboardTypePNG];
}
