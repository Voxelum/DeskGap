cmake_minimum_required(VERSION 3.20)
cmake_policy(SET CMP0091 NEW)

if(WIN32)
    set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded")
endif()

if(APPLE)
    set(ENV{MACOSX_DEPLOYMENT_TARGET} 13.5)
endif()

include(FetchContent)
if(UNIX AND NOT APPLE)
    set(LINUX TRUE)
endif()

project(DeskGap)

set(DG_NODE_MODULES_DIR ${CMAKE_CURRENT_LIST_DIR}/../node_modules)
set(DG_NODE_BIN_DIR ${DG_NODE_MODULES_DIR}/.bin)
set(DG_LIB_DIR ${CMAKE_CURRENT_LIST_DIR}/../lib)

add_subdirectory(${DG_LIB_DIR} lib)

FetchContent_Declare(
    bin2code
    GIT_REPOSITORY https://github.com/patr0nus/bin2code
    GIT_TAG 8499e274c959483c3ecfc10587567a700f083438
)
FetchContent_MakeAvailable(bin2code)

find_program(NPM_EXECUTABLE NAMES npm HINTS /opt/local/bin)
if (NOT DEFINED NPM_EXECUTABLE)
    message(FATAL_ERROR "npm required but not found")
endif()

set(NPM_ESBUILD ${NPM_EXECUTABLE} --prefix ${CMAKE_CURRENT_LIST_DIR}/.. run esbuild --)

if("${CMAKE_SYSTEM_NAME}" STREQUAL "Darwin")
    set(NPM_ESBUILD ${CMAKE_COMMAND} -E env "PATH=$ENV{PATH}:/opt/local/bin" ${NPM_ESBUILD})
endif()

if(WIN32)
    set(NPM_ESBUILD cmd /c ${NPM_ESBUILD})
endif()
add_subdirectory(js)

add_subdirectory(libnode)

add_executable(DeskGapNode
    src/main.cc
    src/node_bindings/index.cc
    src/node_bindings/dispatch/node_dispatch.cc
    src/node_bindings/dispatch/ui_dispatch.cc
    src/node_bindings/external_window/external_window_wrap.cc
    src/node_bindings/app/app_wrap.cc
    src/node_bindings/dialog/dialog_wrap.cc
    src/node_bindings/native_image/native_image_wrap.cc
    src/node_bindings/tray/tray_wrap.cc
    src/node_bindings/menu/menu_wrap.cc
    src/node_bindings/shell/shell_wrap.cc
    src/node_bindings/screen/screen_wrap.cc
    src/node_bindings/clipboard/clipboard_wrap.cc
    src/node_bindings/power_monitor/power_monitor_wrap.cc
    src/node_bindings/notification/notification_wrap.cc
    src/node_bindings/credentials/credentials_wrap.cc
    src/node_bindings/system_preferences/system_preferences_wrap.cc
    src/node_bindings/windows_app_installer/windows_app_installer_wrap.cc
    src/node_bindings/windows_executable/windows_executable_wrap.cc
    src/node_bindings/webview/webview_wrap.cc
    src/node_bindings/window/browser_window_wrap.cc
)
if(WIN32)
    set_source_files_properties(
        src/node_bindings/windows_app_installer/windows_app_installer_wrap.cc
        PROPERTIES COMPILE_OPTIONS "/std:c++17"
    )
endif()
set_target_properties(
    DeskGapNode PROPERTIES
    OUTPUT_NAME DeskGap
    CXX_STANDARD 20
)
target_link_libraries(DeskGapNode PUBLIC deskgap libnode DeskGapNodeScripts)
target_include_directories(DeskGapNode PRIVATE ${DG_NODE_MODULES_DIR}/node-addon-api)
target_compile_options(DeskGapNode PRIVATE $<$<CXX_COMPILER_ID:MSVC>:/Zc:__cplusplus>)

if(APPLE)
    set_target_properties(
        DeskGapNode PROPERTIES
        MACOSX_BUNDLE TRUE
        MACOSX_BUNDLE_INFO_PLIST ${CMAKE_SOURCE_DIR}/src/resources/mac/Info.plist
    )
endif()

if (WIN32)
    target_link_libraries(DeskGapNode PRIVATE wintrust crypt32)
    target_sources(
        DeskGapNode PRIVATE
        ${CMAKE_SOURCE_DIR}/src/resources/win/App.manifest
    )

    set_target_properties(
        DeskGapNode PROPERTIES
        LINK_FLAGS "/ENTRY:\"wmainCRTStartup\""
    )
    target_link_options(DeskGapNode PRIVATE /SUBSYSTEM:$<IF:$<CONFIG:Release>,WINDOWS,CONSOLE>)
endif()

if(NOT "${CMAKE_SYSTEM_NAME}" STREQUAL "Darwin")
    set_target_properties(DeskGapNode PROPERTIES
        RUNTIME_OUTPUT_DIRECTORY $<CONFIG>/DeskGap
    )
endif()

set(DESKGAP_RESOURCE_FOLDER $<TARGET_FILE_DIR:DeskGapNode>/resources)
if(APPLE)
    set(DESKGAP_RESOURCE_FOLDER $<TARGET_BUNDLE_CONTENT_DIR:DeskGapNode>/Resources)
endif()

add_custom_target(DeskGapNodeResources ALL ${CMAKE_COMMAND} -E copy_directory ${CMAKE_CURRENT_LIST_DIR}/app ${DESKGAP_RESOURCE_FOLDER}/app)
add_dependencies(DeskGapNodeResources DeskGapNode)

if("${CMAKE_SYSTEM_NAME}" STREQUAL "Windows")
    add_executable(
        DeskGapBootstrap WIN32
        src/bootstrap/main.cpp
        src/resources/win/App.manifest
    )
    target_compile_features(DeskGapBootstrap PRIVATE cxx_std_20)
    target_include_directories(DeskGapBootstrap PRIVATE ${CMAKE_CURRENT_BINARY_DIR}/libnode/src/deps/zstd/lib)
    target_link_libraries(DeskGapBootstrap PRIVATE deskgap_zstd bcrypt shell32)

    add_custom_command(
        TARGET DeskGapNode
        POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            $<TARGET_FILE:deskgap_winrt>
            $<TARGET_FILE_DIR:DeskGapNode>
    )
endif()
