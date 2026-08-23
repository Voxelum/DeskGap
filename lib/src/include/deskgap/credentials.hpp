#ifndef DESKGAP_CREDENTIALS_HPP
#define DESKGAP_CREDENTIALS_HPP

#include <optional>
#include <string>
#include <vector>

namespace DeskGap {
    class Credentials {
    public:
        struct Credential {
            std::string account;
            std::string password;
        };

        static std::optional<std::string> GetPassword(const std::string& service, const std::string& account);
        static void SetPassword(const std::string& service, const std::string& account, const std::string& password);
        static bool DeletePassword(const std::string& service, const std::string& account);
        static std::vector<Credential> FindCredentials(const std::string& service);
    };
}

#endif
