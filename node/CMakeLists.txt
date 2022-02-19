cmake_minimum_required(VERSION 3.15)
cmake_policy(SET CMP0091 NEW)

if(WIN32)
    set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded")
endif()

if(APPLE)
    set(ENV{MACOSX_DEPLOYMENT_TARGET} 10.11)
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

set(NOD_NODE_VERSION v16.14.0)
if(NOT DEFINED NOD_NODE_OS)
    if (UNIX)
        if (APPLE)
            set(NOD_NODE_OS darwin)
        else()
            set(NOD_NODE_OS linux)
        endif()
    else()
        set(NOD_NODE_OS win32)
    endif()
endif()

if(NOT DEFINED NOD_NODE_ARCH)
    if(CMAKE_SIZEOF_VOID_P EQUAL 4)
        set(NOD_NODE_ARCH x86)
    else()
        set(NOD_NODE_ARCH x64)
    endif()
endif()
set(NOD_NODE_CONFIG -smallicu)

FetchContent_Declare(
    libnode
    URL https://github.com/ci010/libnode/releases/download/${NOD_NODE_VERSION}/libnode-${NOD_NODE_VERSION}-${NOD_NODE_OS}-${NOD_NODE_ARCH}${NOD_NODE_CONFIG}.zip
)
FetchContent_MakeAvailable(libnode)

add_executable(DeskGapNode
    src/main.cc
    src/node_bindings/index.cc
    src/node_bindings/dispatch/node_dispatch.cc
    src/node_bindings/dispatch/ui_dispatch.cc
    src/node_bindings/app/app_wrap.cc
    src/node_bindings/dialog/dialog_wrap.cc
    src/node_bindings/menu/menu_wrap.cc
    src/node_bindings/shell/shell_wrap.cc
    src/node_bindings/system_preferences/system_preferences_wrap.cc
    src/node_bindings/webview/webview_wrap.cc
    src/node_bindings/window/browser_window_wrap.cc
)
set_target_properties(
    DeskGapNode PROPERTIES
    OUTPUT_NAME DeskGap
    CXX_STANDARD 17
)
target_link_libraries(DeskGapNode PUBLIC deskgap libnode DeskGapNodeScripts)
target_include_directories(DeskGapNode PRIVATE ${DG_NODE_MODULES_DIR}/node-addon-api)

if(APPLE)
    set_target_properties(
        DeskGapNode PROPERTIES
        MACOSX_BUNDLE TRUE
        MACOSX_BUNDLE_INFO_PLIST ${CMAKE_SOURCE_DIR}/src/resources/mac/Info.plist
    )
endif()

if (WIN32)
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
    add_custom_target(DeskGapWinRTDLL ALL ${CMAKE_COMMAND} -E copy $<TARGET_FILE:deskgap_winrt> $<TARGET_FILE_DIR:DeskGapNode>)
endif()
