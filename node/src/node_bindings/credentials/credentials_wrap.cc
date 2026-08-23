#include "credentials_wrap.h"

#include <deskgap/credentials.hpp>

namespace {
    enum class Operation { GET, SET, DELETE, FIND };

    class CredentialsWorker: public Napi::AsyncWorker {
    public:
        CredentialsWorker(
            Napi::Env env,
            Operation operation,
            std::string service,
            std::string account = {},
            std::string password = {}
        ): Napi::AsyncWorker(env),
           deferred_(Napi::Promise::Deferred::New(env)),
           operation_(operation),
           service_(std::move(service)),
           account_(std::move(account)),
           password_(std::move(password)) {}

        ~CredentialsWorker() override {
            Wipe(password_);
            if (passwordResult_.has_value()) Wipe(*passwordResult_);
            for (auto& credential: credentialsResult_) Wipe(credential.password);
        }

        Napi::Promise Promise() const { return deferred_.Promise(); }

        void Execute() override {
            try {
                switch (operation_) {
                case Operation::GET: passwordResult_ = DeskGap::Credentials::GetPassword(service_, account_); break;
                case Operation::SET: DeskGap::Credentials::SetPassword(service_, account_, password_); break;
                case Operation::DELETE: deleteResult_ = DeskGap::Credentials::DeletePassword(service_, account_); break;
                case Operation::FIND: credentialsResult_ = DeskGap::Credentials::FindCredentials(service_); break;
                }
            }
            catch (const std::exception& error) {
                SetError(error.what());
            }
        }

        void OnOK() override {
            Napi::Env env = Env();
            switch (operation_) {
            case Operation::GET:
                deferred_.Resolve(passwordResult_.has_value()
                    ? static_cast<Napi::Value>(Napi::String::New(env, *passwordResult_))
                    : env.Null());
                break;
            case Operation::SET:
                deferred_.Resolve(env.Undefined());
                break;
            case Operation::DELETE:
                deferred_.Resolve(Napi::Boolean::New(env, deleteResult_));
                break;
            case Operation::FIND: {
                Napi::Array result = Napi::Array::New(env, credentialsResult_.size());
                for (size_t index = 0; index < credentialsResult_.size(); ++index) {
                    Napi::Object credential = Napi::Object::New(env);
                    credential.Set("account", credentialsResult_[index].account);
                    credential.Set("password", credentialsResult_[index].password);
                    result.Set(static_cast<uint32_t>(index), credential);
                }
                deferred_.Resolve(result);
                break;
            }
            }
        }

        void OnError(const Napi::Error& error) override { deferred_.Reject(error.Value()); }

    private:
        static void Wipe(std::string& value) {
            volatile char* bytes = value.empty() ? nullptr : value.data();
            for (size_t index = 0; index < value.size(); ++index) bytes[index] = 0;
            value.clear();
        }

        Napi::Promise::Deferred deferred_;
        Operation operation_;
        std::string service_;
        std::string account_;
        std::string password_;
        std::optional<std::string> passwordResult_;
        bool deleteResult_ = false;
        std::vector<DeskGap::Credentials::Credential> credentialsResult_;
    };

    Napi::Value Queue(const Napi::CallbackInfo& info, Operation operation) {
        auto* worker = new CredentialsWorker(
            info.Env(),
            operation,
            info[0].As<Napi::String>().Utf8Value(),
            info.Length() > 1 ? info[1].As<Napi::String>().Utf8Value() : std::string(),
            info.Length() > 2 ? info[2].As<Napi::String>().Utf8Value() : std::string()
        );
        Napi::Promise promise = worker->Promise();
        worker->Queue();
        return promise;
    }
}

Napi::Object DeskGap::CredentialsObject(const Napi::Env& env) {
    Napi::Object object = Napi::Object::New(env);
    object.Set("getPassword", Napi::Function::New(env, [](const Napi::CallbackInfo& info) {
        return Queue(info, Operation::GET);
    }));
    object.Set("setPassword", Napi::Function::New(env, [](const Napi::CallbackInfo& info) {
        return Queue(info, Operation::SET);
    }));
    object.Set("deletePassword", Napi::Function::New(env, [](const Napi::CallbackInfo& info) {
        return Queue(info, Operation::DELETE);
    }));
    object.Set("findCredentials", Napi::Function::New(env, [](const Napi::CallbackInfo& info) {
        return Queue(info, Operation::FIND);
    }));
    return object;
}
