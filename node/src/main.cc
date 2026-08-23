#include "../../lib/src/utils/semaphore.hpp"
#include "deskgap/app.hpp"
#include "deskgap/argv.hpp"
#include "cppgc/platform.h"
#include "napi.h"
#include "node_bindings/app/app_startup.hpp"
#include "node_bindings/index.hpp"
#include <iostream>
#include <memory>
#include <thread>
#include <utility>
#include <vector>

#include "node.h"
#include "uv.h"

#include "v8.h"

extern "C" {
extern char BIN2CODE_DG_NODE_JS_CONTENT[];
}
namespace {
    Semaphore appRunSemaphore;
    std::vector<std::string> execArgs;
    std::string resourcePath;

    DeskGap::App::EventCallbacks appEventCallbacks;
} // namespace


namespace {
    int RunNodeInstance(
        node::MultiIsolatePlatform* platform,
        const std::vector<std::string>& args,
        const std::vector<std::string>& exec_args,
        napi_addon_register_func napi_reg_func
    ) {
        std::vector<std::string> errors;
        std::unique_ptr<node::CommonEnvironmentSetup> setup =
            node::CommonEnvironmentSetup::Create(
                platform, &errors, args, exec_args,
                static_cast<node::EnvironmentFlags::Flags>(
                    node::EnvironmentFlags::kDefaultFlags |
                    node::EnvironmentFlags::kNoGlobalSearchPaths
                )
            );

        if (!setup) {
            for (const std::string& error : errors) {
                std::cerr << error << std::endl;
            }
            return 1;
        }

        v8::Isolate* isolate = setup->isolate();
        node::Environment* env = setup->env();
        uv_loop_t* eventLoop = setup->event_loop();
        auto keepAlive = new uv_async_t;
        if (uv_async_init(eventLoop, keepAlive, [](uv_async_t*) {}) != 0) {
            delete keepAlive;
            keepAlive = nullptr;
        }

        int exitCode = 0;
        node::SetProcessExitHandler(env, [&](node::Environment* env, int exit_code) {
            exitCode = exit_code;
            node::Stop(env);
        });

        {
            v8::Locker locker(isolate);
            v8::Isolate::Scope isolate_scope(isolate);
            v8::HandleScope handle_scope(isolate);
            v8::Context::Scope context_scope(setup->context());

            node::AddLinkedBinding(env, "__embedder_mod", napi_reg_func);

            v8::MaybeLocal<v8::Value> loadenv_ret = node::LoadEnvironment(
                env,
                "globalThis.require = require('module').createRequire(process.execPath);"
                "globalThis.__embedder_mod = process._linkedBinding('__embedder_mod');"
                "const content = process.argv[1];"
                "require('vm').runInThisContext(content, { filename: 'builtin:dg_node.js' });"
            );

            if (loadenv_ret.IsEmpty()) {  // There has been a JS exception.
                exitCode = 1;
            }
            else {
                int evtloop_ret = node::SpinEventLoop(env).FromMaybe(1);
                if (exitCode == 0) {
                    exitCode = evtloop_ret;
                }
            }
        }
        if (keepAlive != nullptr) {
            uv_close(reinterpret_cast<uv_handle_t*>(keepAlive), [](uv_handle_t* handle) {
                delete reinterpret_cast<uv_async_t*>(handle);
            });
            uv_run(eventLoop, UV_RUN_NOWAIT);
        }
        node::Stop(env);

        return exitCode;
    }

    int RunNode(
        const std::vector<std::string>& process_args,
        napi_addon_register_func napi_reg_func
    ) {
        if (process_args.empty()) {
            std::cerr << "process args is empty" << std::endl;
            return 1;
        }

        std::shared_ptr<node::InitializationResult> initialization =
            node::InitializeOncePerProcess(
                process_args,
                {
                    node::ProcessInitializationFlags::kNoInitializeV8,
                    node::ProcessInitializationFlags::kNoInitializeNodeV8Platform,
                    node::ProcessInitializationFlags::kDisableCLIOptions,
                    node::ProcessInitializationFlags::kDisableNodeOptionsEnv,
                    node::ProcessInitializationFlags::kNoInitializeCppgc,
                }
            );

        for (const std::string& error : initialization->errors()) {
            std::cerr << error << std::endl;
        }
        if (initialization->early_return()) {
            return initialization->exit_code();
        }

        std::unique_ptr<node::MultiIsolatePlatform> platform =
            node::MultiIsolatePlatform::Create(4);
        v8::V8::InitializePlatform(platform.get());
        cppgc::InitializeProcess(platform->GetPageAllocator());
        v8::V8::Initialize();

        int exitCode = RunNodeInstance(
            platform.get(),
            initialization->args(),
            initialization->exec_args(),
            napi_reg_func
        );

        cppgc::ShutdownProcess();
        v8::V8::Dispose();
        v8::V8::DisposePlatform();
        node::TearDownOncePerProcess();

        return exitCode;
    }
}

namespace DeskGap {
    const std::vector<std::string> &AppStartup::ExecArgs() { return execArgs; }
    const std::string &AppStartup::ResourcePath() { return resourcePath; }
    void AppStartup::SignalAppRun(App::EventCallbacks &&eventCallbacks) {
        appEventCallbacks = std::move(eventCallbacks);
        appRunSemaphore.signal();
    }

    int startNodeWithArgs(const std::vector<const char *> &args) {
        std::vector<std::string> processArgs(args.begin(), args.end());
        return RunNode(
            processArgs,
            [](napi_env env, napi_value exports) -> napi_value {
                return Napi::RegisterModule(env, exports,
                                            DeskGap::InitNodeNativeModule);
            }
        );
    }
} // namespace DeskGap


#ifdef WIN32
int wmain(int argc, const wchar_t **argv)
#else
int main(int argc, const char **argv)
#endif
{
    DeskGap::App::Init();

    std::thread nodeThread([argc, argv]() {
        execArgs = DeskGap::Argv(argc, argv);
        const char *argv0 = execArgs[0].c_str();
        resourcePath = DeskGap::App::GetResourcePath(argv0);
        exit(DeskGap::startNodeWithArgs({argv0, BIN2CODE_DG_NODE_JS_CONTENT}));
    });

    appRunSemaphore.wait();
    DeskGap::App::Run(std::move(appEventCallbacks));

    return 0;
}
