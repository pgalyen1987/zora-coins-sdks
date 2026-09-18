// zora-rewards: what addresses earned from Zora coin trading fees, read from Base.
//   zora-rewards [--hours N] ADDRESS...
#include <cstdlib>
#include <iostream>
#include <string>
#include <vector>

#include "zora/rewards.hpp"

int main(int argc, char** argv) {
    double hours = 24;
    std::vector<std::string> addresses;
    for (int i = 1; i < argc; ++i) {
        std::string a = argv[i];
        if (a == "--hours" && i + 1 < argc) hours = std::atof(argv[++i]);
        else if (a == "-h" || a == "--help") {
            std::cerr << "usage: zora-rewards [--hours N] ADDRESS...\n";
            return 0;
        } else addresses.push_back(a);
    }
    if (addresses.empty()) {
        std::cerr << "usage: zora-rewards [--hours N] ADDRESS...\n";
        return 2;
    }
    try {
        zora::rewards::MemoryStore store;
        zora::rewards::Indexer idx(store);
        std::int64_t head = idx.head();
        int n = idx.scan(addresses, head - static_cast<std::int64_t>(hours * 1800), head);
        std::cerr << "  " << n << " reward events\n";
        zora::Client client;
        std::cout << zora::rewards::report_text(store.events_for(addresses), addresses, &client);
    } catch (const std::exception& e) {
        std::cerr << "zora-rewards: " << e.what() << "\n";
        return 1;
    }
}
