// Headless smoke test: no NSApplication, windows, or Launch Services writes.
#import <Foundation/Foundation.h>
#include <deskgap/app.hpp>
#include <cassert>
#include <spawn.h>
#include <sys/wait.h>
#include <unistd.h>
#include <csignal>
#include <iostream>
extern char** environ;

int main(int argc, char** argv) {
    @autoreleasepool {
        using DeskGap::App;
        if (argc > 1) {
            bool acquired = App::RequestSingleInstanceLock({});
            if (std::string(argv[1]) == "contend") return acquired ? 10 : 0;
            if (!acquired) return 11;
            if (std::string(argv[1]) == "crash") _exit(0);
            App::ReleaseSingleInstanceLock();
            return 0;
        }
        auto spawn = [&](const char* mode) {
            pid_t pid;
            char* args[] = {argv[0], const_cast<char*>(mode), nullptr};
            assert(posix_spawn(&pid, argv[0], nullptr, nullptr, args, environ) == 0);
            return pid;
        };
        auto wait = [](pid_t pid) {
            int status;
            assert(waitpid(pid, &status, 0) == pid);
            assert(WIFEXITED(status) && WEXITSTATUS(status) == 0);
        };
        assert(!App::HasSingleInstanceLock());
        App::ReleaseSingleInstanceLock();
        bool notified = false;
        assert(App::RequestSingleInstanceLock([&](const std::string&& args, const std::string&& cwd) {
            assert(args.find("contend") != std::string::npos);
            assert(cwd == std::string([[NSFileManager defaultManager] currentDirectoryPath].UTF8String));
            notified = true;
        }));
        assert(App::HasSingleInstanceLock());
        assert(App::RequestSingleInstanceLock({})); // idempotent; preserves callback
        pid_t contender = spawn("contend");
        CFAbsoluteTime deadline = CFAbsoluteTimeGetCurrent() + 5;
        while (!notified && CFAbsoluteTimeGetCurrent() < deadline)
            CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.05, true);
        wait(contender);
        assert(notified);
        App::ReleaseSingleInstanceLock();
        assert(!App::HasSingleInstanceLock());
        wait(spawn("acquire")); // explicit release makes lock available
        wait(spawn("crash")); // kernel reclaims port even without cleanup
        wait(spawn("acquire"));
        assert(App::RequestSingleInstanceLock({}));
        App::ReleaseSingleInstanceLock();
        for (const std::string& protocol : {"", "1bad", "has:colon", "has/slash", "https"}) {
            assert(!App::SetAsDefaultProtocolClient(protocol));
            assert(!App::IsDefaultProtocolClient(protocol));
        }
        assert(!App::SetAsDefaultProtocolClient(std::string("valid\0hidden", 12)));
        std::cout << "PASS: contention, notification, release, crash recovery, protocol rejection\n";
    }
}
