#include "shell.hpp"
#include "./util/wstring_utf8.h"
#include <Windows.h>
#include <shellapi.h>
#include <shlobj.h>
#include <propkey.h>
#include <propvarutil.h>
#include <comdef.h>
#include <filesystem>
#include <system_error>
#include <wrl/client.h>

namespace fs = std::filesystem;

bool DeskGap::Shell::OpenExternal(const std::string &urlString)
{
    std::wstring wUrlString = UTF8ToWString(urlString.c_str());
    return ShellExecuteW(
               nullptr, L"open",
               wUrlString.c_str(),
               nullptr, nullptr,
               SW_SHOWNORMAL) > (HINSTANCE)32;
}

std::string DeskGap::Shell::OpenPath(const std::string &path)
{
    std::wstring widePath = UTF8ToWString(path.c_str());
    SHELLEXECUTEINFOW executeInfo{ sizeof(executeInfo) };
    executeInfo.fMask = SEE_MASK_FLAG_NO_UI;
    executeInfo.lpVerb = L"open";
    executeInfo.lpFile = widePath.c_str();
    executeInfo.nShow = SW_SHOWNORMAL;
    if (ShellExecuteExW(&executeInfo)) {
        return "";
    }
    return std::system_category().message(GetLastError());
}

bool DeskGap::Shell::ShowItemInFolder(const std::string &path)
{
    // copy from electron ShowItemInFolder
    Microsoft::WRL::ComPtr<IShellFolder> desktop;
    HRESULT hr = SHGetDesktopFolder(desktop.GetAddressOf());
    if (FAILED(hr))
        return false;

    fs::path full_path(path);
    fs::path dir(full_path.parent_path());

    ITEMIDLIST *dir_item;
    hr = desktop->ParseDisplayName(NULL, NULL,
                                   const_cast<wchar_t *>(dir.c_str()),
                                   NULL, &dir_item, NULL);

    if (FAILED(hr))
        return false;

    ITEMIDLIST *file_item;
    hr = desktop->ParseDisplayName(
        NULL, NULL, const_cast<wchar_t *>(full_path.c_str()), NULL,
        &file_item, NULL);

    if (FAILED(hr))
        return false;

    const ITEMIDLIST *highlight[] = {file_item};
    hr = SHOpenFolderAndSelectItems(dir_item, std::size(highlight), highlight, NULL);

    if (FAILED(hr))
    {
        if (hr == ERROR_FILE_NOT_FOUND)
        {
            // On some systems, the above call mysteriously fails with "file not
            // found" even though the file is there.  In these cases, ShellExecute()
            // seems to work as a fallback (although it won't select the file).
            ShellExecute(NULL, L"open", dir.c_str(), NULL, NULL, SW_SHOW);
        }
    }

    CoTaskMemFree(dir_item);
    CoTaskMemFree(file_item);

    return true;
}

bool DeskGap::Shell::WriteShortcutLink(
    const std::string& shortcutPath,
    const std::string& operation,
    const ShortcutDetails& details
) {
    if (operation != "create" && operation != "update" && operation != "replace") {
        return false;
    }

    const std::wstring wideShortcutPath = UTF8ToWString(shortcutPath.c_str());
    const bool shortcutExists = fs::exists(fs::path(wideShortcutPath));
    if ((operation == "create" && shortcutExists) || (operation == "update" && !shortcutExists)) {
        return false;
    }

    Microsoft::WRL::ComPtr<IShellLinkW> shellLink;
    HRESULT result = CoCreateInstance(
        CLSID_ShellLink,
        nullptr,
        CLSCTX_INPROC_SERVER,
        IID_PPV_ARGS(shellLink.GetAddressOf())
    );
    if (FAILED(result)) return false;

    Microsoft::WRL::ComPtr<IPersistFile> persistFile;
    result = shellLink.As(&persistFile);
    if (FAILED(result)) return false;
    if (operation == "update") {
        result = persistFile->Load(wideShortcutPath.c_str(), STGM_READWRITE);
        if (FAILED(result)) return false;
    }

    const auto setString = [](const std::optional<std::string>& value, auto setter) {
        if (!value.has_value()) return true;
        const std::wstring wideValue = UTF8ToWString(value->c_str());
        return SUCCEEDED(setter(wideValue.c_str()));
    };
    if (!setString(details.target, [&](const wchar_t* value) { return shellLink->SetPath(value); })
        || !setString(details.cwd, [&](const wchar_t* value) { return shellLink->SetWorkingDirectory(value); })
        || !setString(details.args, [&](const wchar_t* value) { return shellLink->SetArguments(value); })
        || !setString(details.description, [&](const wchar_t* value) { return shellLink->SetDescription(value); })) {
        return false;
    }
    if (details.icon.has_value()) {
        const std::wstring wideIcon = UTF8ToWString(details.icon->c_str());
        if (FAILED(shellLink->SetIconLocation(wideIcon.c_str(), details.iconIndex))) return false;
    }

    if (details.appUserModelId.has_value() || details.toastActivatorClsid.has_value()) {
        Microsoft::WRL::ComPtr<IPropertyStore> propertyStore;
        result = shellLink.As(&propertyStore);
        if (FAILED(result)) return false;

        if (details.appUserModelId.has_value()) {
            PROPVARIANT value;
            PropVariantInit(&value);
            const std::wstring appId = UTF8ToWString(details.appUserModelId->c_str());
            result = InitPropVariantFromString(appId.c_str(), &value);
            if (SUCCEEDED(result)) result = propertyStore->SetValue(PKEY_AppUserModel_ID, value);
            PropVariantClear(&value);
            if (FAILED(result)) return false;
        }
        if (details.toastActivatorClsid.has_value()) {
            GUID toastActivator;
            const std::wstring clsid = UTF8ToWString(details.toastActivatorClsid->c_str());
            result = CLSIDFromString(clsid.c_str(), &toastActivator);
            if (FAILED(result)) return false;
            PROPVARIANT value;
            PropVariantInit(&value);
            result = InitPropVariantFromCLSID(toastActivator, &value);
            if (SUCCEEDED(result)) result = propertyStore->SetValue(PKEY_AppUserModel_ToastActivatorCLSID, value);
            PropVariantClear(&value);
            if (FAILED(result)) return false;
        }
        if (FAILED(propertyStore->Commit())) return false;
    }

    return SUCCEEDED(persistFile->Save(wideShortcutPath.c_str(), TRUE));
}
