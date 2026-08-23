cmake_minimum_required(VERSION 3.20)

include(ExternalProject)
find_program(NodeJS_EXECUTABLE NAMES node REQUIRED)

set(DESKGAP_NODE_VERSION "24.13.1" CACHE STRING "Node.js version embedded by DeskGap")
set(
    DESKGAP_NODE_SOURCE_SHA256
    "16f241ebb9429d76936021a51d477d1ed7310ffbff71753c65c4b8805210d3ae"
    CACHE STRING
    "SHA-256 checksum of the Node.js source archive"
)

set(NODE_SOURCE_DIR ${CMAKE_CURRENT_BINARY_DIR}/src)
set(NODE_INSTALL_DIR ${CMAKE_CURRENT_BINARY_DIR}/install)

if(CMAKE_SIZEOF_VOID_P EQUAL 4)
    set(NODE_ARCH x86)
elseif(CMAKE_SYSTEM_PROCESSOR MATCHES "^(aarch64|arm64|ARM64)$")
    set(NODE_ARCH arm64)
else()
    set(NODE_ARCH x64)
endif()

if(WIN32)
    set(NODE_LIBRARY ${NODE_INSTALL_DIR}/lib/libnode.lib)
else()
    set(NODE_LIBRARY ${NODE_INSTALL_DIR}/lib/libnode.a)
endif()

ExternalProject_Add(
    deskgap_node
    URL https://nodejs.org/dist/v${DESKGAP_NODE_VERSION}/node-v${DESKGAP_NODE_VERSION}.tar.gz
    URL_HASH SHA256=${DESKGAP_NODE_SOURCE_SHA256}
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE
    SOURCE_DIR ${NODE_SOURCE_DIR}
    CONFIGURE_COMMAND ""
    BUILD_COMMAND
        ${NodeJS_EXECUTABLE}
        ${CMAKE_CURRENT_LIST_DIR}/build.mjs
        --source ${NODE_SOURCE_DIR}
        --install ${NODE_INSTALL_DIR}
        --arch ${NODE_ARCH}
    INSTALL_COMMAND ""
    BUILD_BYPRODUCTS ${NODE_LIBRARY}
    USES_TERMINAL_BUILD TRUE
)

file(MAKE_DIRECTORY ${NODE_INSTALL_DIR}/include/node)
add_library(libnode STATIC IMPORTED GLOBAL)
set_target_properties(
    libnode
    PROPERTIES
        IMPORTED_LOCATION ${NODE_LIBRARY}
        INTERFACE_INCLUDE_DIRECTORIES ${NODE_INSTALL_DIR}/include/node
)
add_dependencies(libnode deskgap_node)

if(WIN32)
    add_library(deskgap_zstd STATIC IMPORTED GLOBAL)
    set_target_properties(
        deskgap_zstd
        PROPERTIES
            IMPORTED_LOCATION ${NODE_SOURCE_DIR}/out/Release/lib/zstd.lib
    )
    add_dependencies(deskgap_zstd deskgap_node)

    target_link_libraries(libnode INTERFACE ws2_32 dbghelp crypt32 winmm iphlpapi psapi userenv)
    if(CMAKE_SIZEOF_VOID_P EQUAL 4)
        target_link_options(libnode INTERFACE /SAFESEH:NO)
    endif()
elseif(APPLE)
    target_link_libraries(libnode INTERFACE "-framework CoreFoundation" "-framework Security")
else()
    target_link_libraries(libnode INTERFACE pthread dl rt m)
    target_link_options(libnode INTERFACE -rdynamic)
endif()