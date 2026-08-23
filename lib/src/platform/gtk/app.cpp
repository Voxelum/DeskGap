#include <gtk/gtk.h>
#include <functional>
#include <memory>
#include <cstdlib>
#include <unordered_map>
#include <filesystem>

#include "app.hpp"
#include "util/xdg-user-dir-lookup.h"

using std::shared_ptr;
using std::function;
using std::make_shared;

namespace {
    GtkApplication* gtkApp;
}

namespace DeskGap {
    void App::Init() {
        std::string applicationId = "io.deskgap.Application" + std::to_string(std::hash<std::string>{}(GetExecutablePath()));
        gtkApp = gtk_application_new(applicationId.c_str(), G_APPLICATION_NON_UNIQUE);
        g_application_hold(G_APPLICATION(gtkApp));
        // Suppress no activate handler warning:
        g_signal_connect(gtkApp, "activate", G_CALLBACK([](){ }), nullptr);
    }
    void App::Run(EventCallbacks&& callbacks) {
        callbacks.onReady();
        g_application_run(G_APPLICATION(gtkApp), 0, NULL);
        g_object_unref(gtkApp);
    }
    
    void App::Exit(int exitCode) {
        std::exit(exitCode);
    }

    std::string App::GetLocale() {
        const char* const* languages = g_get_language_names();
        return languages != nullptr && languages[0] != nullptr ? languages[0] : "en";
    }

    void App::SetAppUserModelId(const std::string&) {
    }

    bool App::SetDockVisible(bool) { return false; }
    bool App::IsDockVisible() { return false; }

    std::string App::GetExecutablePath() {
        std::error_code error;
        std::filesystem::path executablePath = std::filesystem::read_symlink("/proc/self/exe", error);
        return error ? std::string() : executablePath.string();
    }

    std::string App::GetPath(PathName name) {
        static std::unordered_map<PathName, const char*> xdgDirTypeByPathName {
            { PathName::DESKTOP, "DESKTOP" },
            { PathName::DOCUMENTS, "DOCUMENTS" },
            { PathName::DOWNLOADS, "DOWNLOAD" },
            { PathName::MUSIC, "MUSIC" },
            { PathName::PICTURES, "PICTURES" },
            { PathName::VIDEOS, "VIDEOS" },
        };

        if (name == PathName::APP_DATA) {
            if (const char* xdgConfigHome = getenv("XDG_CONFIG_HOME"); xdgConfigHome != nullptr) {
                return xdgConfigHome;
            }
            else {
                return std::string(g_get_home_dir()) + "/.config";
            }
            return g_get_home_dir();
        }
        else if (name == PathName::LOCAL_APP_DATA) {
            if (const char* xdgDataHome = getenv("XDG_DATA_HOME"); xdgDataHome != nullptr && *xdgDataHome != '\0') {
                return xdgDataHome;
            }
            return std::string(g_get_home_dir()) + "/.local/share";
        }
        else if (name == PathName::CACHE) {
            if (const char* xdgCacheHome = getenv("XDG_CACHE_HOME"); xdgCacheHome != nullptr && *xdgCacheHome != '\0') {
                return xdgCacheHome;
            }
            return std::string(g_get_home_dir()) + "/.cache";
        }
        else if (name == PathName::HOME) {
            return g_get_home_dir();
        }
        else if (name == PathName::TEMP) {
            return g_get_tmp_dir();
        }
        else {
            char* cresult = xdg_user_dir_lookup(xdgDirTypeByPathName[name]);
            std::string result(cresult);
            free(cresult);
            return std::move(result);
        }
    }

    std::string App::GetResourcePath(const char* argv0) {
        namespace fs = std::filesystem;
        std::error_code err;
        fs::path execPath = GetExecutablePath();
        if (execPath.empty()) execPath.assign(argv0);
        return (execPath.parent_path() / "resources").string();
    }
}
