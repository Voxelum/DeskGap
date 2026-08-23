#import <Cocoa/Cocoa.h>

#include "shell.hpp"
#include "./util/string_convert.h"

bool DeskGap::Shell::OpenExternal(const std::string& urlString) {
    NSURL* url = [NSURL URLWithString: NSStr(urlString)];
    if (!url) {
        return false;
    }
    return [[NSWorkspace sharedWorkspace] openURL: url];
}

std::string DeskGap::Shell::OpenPath(const std::string& path) {
    NSURL* url = [NSURL fileURLWithPath: NSStr(path)];
    if ([[NSWorkspace sharedWorkspace] openURL: url]) {
        return "";
    }
    return "Failed to open path";
}

bool DeskGap::Shell::ShowItemInFolder(const std::string& path) {
    NSURL* url = [NSURL fileURLWithPath: NSStr(path)];
    [[NSWorkspace sharedWorkspace] activateFileViewerSelectingURLs: @[url]];
    return true;
}

bool DeskGap::Shell::WriteShortcutLink(
    const std::string&,
    const std::string&,
    const ShortcutDetails&
) {
    return false;
}
