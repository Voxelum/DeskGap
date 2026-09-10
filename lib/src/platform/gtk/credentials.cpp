#include "credentials.hpp"

#include <libsecret/secret.h>
#include <stdexcept>

namespace {
    const SecretSchema credentialSchema = {
        "io.deskgap.Credentials",
        SECRET_SCHEMA_NONE,
        {
            { "service", SECRET_SCHEMA_ATTRIBUTE_STRING },
            { "account", SECRET_SCHEMA_ATTRIBUTE_STRING },
            { nullptr, SECRET_SCHEMA_ATTRIBUTE_STRING },
        },
    };

    std::runtime_error MakeSecretError(const char* operation, GError* error) {
        std::string message = error == nullptr ? "secure storage backend unavailable" : error->message;
        if (error != nullptr) g_error_free(error);
        return std::runtime_error(std::string(operation) + " failed: " + message);
    }
}

std::optional<std::string> DeskGap::Credentials::GetPassword(
    const std::string& service,
    const std::string& account
) {
    GError* error = nullptr;
    gchar* password = secret_password_lookup_sync(
        &credentialSchema, nullptr, &error,
        "service", service.c_str(),
        "account", account.c_str(),
        nullptr
    );
    if (error != nullptr) throw MakeSecretError("Secret Service lookup", error);
    if (password == nullptr) return std::nullopt;
    std::string result(password);
    secret_password_free(password);
    return result;
}

void DeskGap::Credentials::SetPassword(
    const std::string& service,
    const std::string& account,
    const std::string& password
) {
    GError* error = nullptr;
    std::string label = service + " (" + account + ")";
    if (!secret_password_store_sync(
        &credentialSchema,
        SECRET_COLLECTION_DEFAULT,
        label.c_str(),
        password.c_str(),
        nullptr,
        &error,
        "service", service.c_str(),
        "account", account.c_str(),
        nullptr
    )) {
        throw MakeSecretError("Secret Service store", error);
    }
}

bool DeskGap::Credentials::DeletePassword(const std::string& service, const std::string& account) {
    GError* error = nullptr;
    gboolean deleted = secret_password_clear_sync(
        &credentialSchema, nullptr, &error,
        "service", service.c_str(),
        "account", account.c_str(),
        nullptr
    );
    if (error != nullptr) throw MakeSecretError("Secret Service delete", error);
    return deleted;
}

std::vector<DeskGap::Credentials::Credential> DeskGap::Credentials::FindCredentials(const std::string& service) {
    GError* error = nullptr;
    GList* items = secret_password_search_sync(
        &credentialSchema,
        static_cast<SecretSearchFlags>(SECRET_SEARCH_ALL | SECRET_SEARCH_UNLOCK | SECRET_SEARCH_LOAD_SECRETS),
        nullptr,
        &error,
        "service", service.c_str(),
        nullptr
    );
    if (error != nullptr) throw MakeSecretError("Secret Service search", error);

    std::vector<Credential> result;
    for (GList* current = items; current != nullptr; current = current->next) {
        SecretRetrievable* item = SECRET_RETRIEVABLE(current->data);
        GHashTable* attributes = secret_retrievable_get_attributes(item);
        const gchar* account = attributes == nullptr
            ? nullptr
            : static_cast<const gchar*>(g_hash_table_lookup(attributes, "account"));
        GError* retrieveError = nullptr;
        SecretValue* value = secret_retrievable_retrieve_secret_sync(item, nullptr, &retrieveError);
        if (retrieveError != nullptr) {
            if (attributes != nullptr) g_hash_table_unref(attributes);
            g_list_free_full(items, g_object_unref);
            throw MakeSecretError("Secret Service retrieve", retrieveError);
        }
        if (account != nullptr && value != nullptr) {
            const gchar* password = secret_value_get_text(value);
            if (password != nullptr) result.push_back({ account, password });
        }
        if (value != nullptr) secret_value_unref(value);
        if (attributes != nullptr) g_hash_table_unref(attributes);
    }
    g_list_free_full(items, g_object_unref);
    return result;
}
