add_library(deskgap_winrt SHARED winrt_webview.cpp)

target_compile_features(deskgap_winrt PRIVATE cxx_std_17)

set_target_properties(deskgap_winrt PROPERTIES
    CXX_STANDARD 17
    CXX_EXTENSIONS OFF
    CXX_STANDARD_REQUIRED ON
)
target_include_directories(deskgap_winrt PRIVATE ../../include/deskgap)

target_compile_options(deskgap_winrt
    PUBLIC -GR -await
)

# target_compile_options(deskgap_winrt PRIVATE /W4)

target_compile_definitions(deskgap_winrt
    PUBLIC WIN32_LEAN_AND_MEAN UNICODE _UNICODE
    PRIVATE DESKGAP_EXPORTING
)

find_program(NUGET_EXE NAMES nuget [../../../../])
    if(NOT NUGET_EXE)
        message("NUGET.EXE not found.")
        message(FATAL_ERROR "Please install this executable, and run CMake again.")
    endif()

    exec_program(${NUGET_EXE}
        ARGS install "Microsoft.Web.WebView2" -Version 1.0.1072.54 -ExcludeVersion -OutputDirectory ${CMAKE_BINARY_DIR}/packages)
    exec_program(${NUGET_EXE}
        ARGS install "Microsoft.Windows.ImplementationLibrary" -ExcludeVersion -OutputDirectory ${CMAKE_BINARY_DIR}/packages)

add_library(deskgap_platform_trident_preload_script STATIC
    ${CMAKE_CURRENT_BINARY_DIR}/dg_preload_trident.c
)
add_library(deskgap_platform_winrt_preload_script STATIC
    ${CMAKE_CURRENT_BINARY_DIR}/dg_preload_winrt.c
)

target_link_libraries(deskgap_winrt PRIVATE deskgap_platform_winrt_preload_script)

bin2code(${CMAKE_CURRENT_LIST_DIR}/dg_preload_trident.js ${CMAKE_CURRENT_BINARY_DIR}/dg_preload_trident.c)
bin2code(${CMAKE_CURRENT_LIST_DIR}/dg_preload_winrt.js ${CMAKE_CURRENT_BINARY_DIR}/dg_preload_winrt.c)

target_sources(deskgap_platform PRIVATE
    argv.cpp
    app.cpp
    dialog.cpp
    menu.cpp
    dispatch.cpp
    shell.cpp
    system_preferences.cpp
    trident_webview.cpp
    webview2_webview.cpp
    webview.cpp
    exception.cpp
    BrowserWindow.cpp
    delay_load_hook.cpp
    util/dpi.cpp
    util/winrt.cpp
)

target_link_libraries(deskgap_platform PRIVATE deskgap_platform_trident_preload_script deskgap_winrt)
target_link_libraries(deskgap_platform INTERFACE Version.lib Shlwapi.lib ${CMAKE_BINARY_DIR}/packages/Microsoft.Web.WebView2/build/native/x86/WebView2LoaderStatic.lib ${CMAKE_BINARY_DIR}/packages/Microsoft.Windows.ImplementationLibrary/build/native/Microsoft.Windows.ImplementationLibrary.targets)
target_include_directories(deskgap_platform SYSTEM PUBLIC ${CMAKE_BINARY_DIR}/packages/Microsoft.Web.WebView2/build/native/include ${CMAKE_BINARY_DIR}/packages/Microsoft.Windows.ImplementationLibrary/include)

target_link_options(deskgap_platform PUBLIC "/DELAYLOAD:deskgap_winrt.dll")
