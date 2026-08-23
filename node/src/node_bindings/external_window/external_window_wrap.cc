#include "external_window_wrap.h"

#include <deskgap/external_window.hpp>
#include <atomic>
#include <chrono>
#include <iomanip>
#include <memory>
#include <sstream>
#include <thread>

namespace {
    struct CancellationState {
        std::atomic<bool> cancelled = false;
    };

    class MoveWorker final: public Napi::AsyncWorker {
    public:
        MoveWorker(
            Napi::Env env,
            uint32_t processId,
            DeskGap::ExternalWindow::Bounds bounds,
            uint32_t timeout,
            bool dipCoordinates,
            std::shared_ptr<CancellationState> cancellation
        ): Napi::AsyncWorker(env),
           deferred_(Napi::Promise::Deferred::New(env)),
           processId_(processId),
           bounds_(bounds),
           timeout_(timeout),
           dipCoordinates_(dipCoordinates),
           cancellation_(std::move(cancellation)) {}

        Napi::Promise Promise() const { return deferred_.Promise(); }

        void Execute() override {
            const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeout_);
            while (!cancellation_->cancelled) {
                result_ = DeskGap::ExternalWindow::TryMoveAndResize(processId_, bounds_, dipCoordinates_);
                if (result_.status != DeskGap::ExternalWindow::Status::NOT_FOUND) return;
                if (std::chrono::steady_clock::now() >= deadline) return;
                std::this_thread::sleep_for(std::chrono::milliseconds(50));
            }
        }

        void OnOK() override {
            if (cancellation_->cancelled) {
                Reject("AbortError", "ERR_EXTERNAL_WINDOW_CANCELLED", "External window operation was cancelled");
                return;
            }
            switch (result_.status) {
            case DeskGap::ExternalWindow::Status::SUCCESS:
                deferred_.Resolve(Env().Undefined());
                return;
            case DeskGap::ExternalWindow::Status::NOT_FOUND:
                Reject("Error", "ERR_EXTERNAL_WINDOW_NOT_FOUND", "Cannot find a visible external window for the process");
                return;
            case DeskGap::ExternalWindow::Status::UNSUPPORTED:
                Reject("Error", "ERR_EXTERNAL_WINDOW_UNSUPPORTED", "External window management is not supported in this environment");
                return;
            case DeskGap::ExternalWindow::Status::FAILED:
                Reject("Error", NativeErrorCode(), result_.message.empty() ? "External window operation failed" : result_.message);
                return;
            }
        }

        void OnError(const Napi::Error& error) override { deferred_.Reject(error.Value()); }

    private:
        std::string NativeErrorCode() const {
            std::ostringstream stream;
#ifdef _WIN32
            stream << "WIN32_";
#else
            stream << "NATIVE_";
#endif
            stream << result_.errorCode;
            return stream.str();
        }

        void Reject(const char* name, const std::string& code, const std::string& message) {
            Napi::Object error = Napi::Error::New(Env(), message).Value();
            error.Set("name", name);
            error.Set("code", code);
            if (result_.errorCode != 0) error.Set("nativeCode", Napi::Number::New(Env(), result_.errorCode));
            deferred_.Reject(error);
        }

        Napi::Promise::Deferred deferred_;
        uint32_t processId_;
        DeskGap::ExternalWindow::Bounds bounds_;
        uint32_t timeout_;
        bool dipCoordinates_;
        std::shared_ptr<CancellationState> cancellation_;
        DeskGap::ExternalWindow::Result result_ { DeskGap::ExternalWindow::Status::NOT_FOUND };
    };
}

Napi::Object DeskGap::ExternalWindowObject(const Napi::Env& env) {
    Napi::Object object = Napi::Object::New(env);
    object.Set("isSupported", Napi::Function::New(env, [](const Napi::CallbackInfo& info) {
        return Napi::Boolean::New(info.Env(), ExternalWindow::IsSupported());
    }));
    object.Set("moveAndResize", Napi::Function::New(env, [](const Napi::CallbackInfo& info) {
        auto cancellation = std::make_shared<CancellationState>();
        auto* worker = new MoveWorker(
            info.Env(),
            info[0].As<Napi::Number>().Uint32Value(),
            {
                info[1].As<Napi::Number>().DoubleValue(),
                info[2].As<Napi::Number>().DoubleValue(),
                info[3].As<Napi::Number>().DoubleValue(),
                info[4].As<Napi::Number>().DoubleValue(),
            },
            info[5].As<Napi::Number>().Uint32Value(),
            info[6].As<Napi::Boolean>().Value(),
            cancellation
        );
        Napi::Object result = Napi::Object::New(info.Env());
        result.Set("promise", worker->Promise());
        result.Set("cancel", Napi::Function::New(info.Env(), [cancellation](const Napi::CallbackInfo&) {
            cancellation->cancelled = true;
        }));
        worker->Queue();
        return result;
    }));
    return object;
}