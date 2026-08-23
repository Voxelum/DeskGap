bin2code(${CMAKE_CURRENT_LIST_DIR}/dg_preload_gtk.js ${CMAKE_CURRENT_BINARY_DIR}/dg_preload_gtk.c)

add_library(deskgap_platform_preload_script STATIC ${CMAKE_CURRENT_BINARY_DIR}/dg_preload_gtk.c)
target_link_libraries(deskgap_platform PRIVATE deskgap_platform_preload_script)

find_package(PkgConfig REQUIRED)
pkg_check_modules(gtk REQUIRED IMPORTED_TARGET gtk+-3.0>=3.18.9)
pkg_check_modules(webkit REQUIRED IMPORTED_TARGET webkit2gtk-4.1>=2.40)
pkg_check_modules(secret REQUIRED IMPORTED_TARGET libsecret-1>=0.20)
pkg_check_modules(x11 REQUIRED IMPORTED_TARGET x11)
target_link_libraries(deskgap_platform PRIVATE PkgConfig::gtk PkgConfig::webkit PkgConfig::secret PkgConfig::x11 stdc++fs)

target_sources(deskgap_platform PRIVATE
    app.cpp
    BrowserWindow.cpp
    dialog.cpp
    glib_exception.cpp
    exception.cpp
    menu.cpp
    native_image.cpp
    shell.cpp
    screen.cpp
    clipboard.cpp
    power_monitor.cpp
    notification.cpp
    credentials.cpp
    external_window.cpp
    system_preferences.cpp
    tray.cpp
    ui_dispatch_platform.cpp
    webview.cpp
)
