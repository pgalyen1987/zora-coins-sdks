# zora-coins for C++

A C++17 client for the [Zora Coins API](https://docs.zora.co/coins): all 30 endpoints, callback pagination, retries, a GraphQL client, and an onchain indexer for the creator and referral rewards Zora pays on Base. JSON via [nlohmann/json](https://github.com/nlohmann/json); HTTP via libcurl behind a `Transport` interface, so you can route it through your engine's own HTTP stack.

> Unofficial and community-maintained. Not affiliated with Zora.

```cmake
include(FetchContent)
FetchContent_Declare(zora_coins GIT_REPOSITORY https://github.com/pgalyen1987/zora-coins-sdks.git GIT_TAG v0.1.1 SOURCE_SUBDIR cpp)
FetchContent_MakeAvailable(zora_coins)
target_link_libraries(my_app PRIVATE zora::coins)
```

Needs libcurl (`apt install libcurl4-openssl-dev`, `brew install curl`, or vcpkg `curl`). nlohmann/json is fetched if it isn't installed.

## Quick start

```cpp
#include "zora/zora.hpp"

zora::Client client;  // reads ZORA_API_KEY; or zora::ClientOptions{…}

if (auto coin = client.coin("0x0b8590d3c0b1ee6c797e184a4afbb15f8f58a46b")) {  // empty if there's no such coin
    std::cout << coin->name.value_or("") << " " << coin->market_cap.value_or("") << "\n";
}

client.for_each_coin_holders(addr, {}, [](const zora::TokenBalance& h) {
    std::cout << h.owner_address.value_or("") << " " << h.balance.value_or("") << "\n";  // 18-decimal integer string
    return true;  // false stops; pages are fetched as needed
});
```

Response fields are `std::optional`. Enums are extensible structs, so values Zora adds later are kept.

## Errors, trading, GraphQL

```cpp
try {
    auto q = client.quote_trade(zora::Client::eth(), zora::Client::erc20(coin), "1000000000000000", wallet, my_app);
    // q.call->target / data / value: sign with your wallet
} catch (const zora::ApiError& e) {
    if (e.is_insufficient_liquidity()) { /* the pool can't fill that size */ }
}

zora::GraphQLClient gql("http://localhost:8080/graphql");
auto data = gql.query("query($a: String!) { coin(address: $a) { name marketCap } }", {{"a", addr}});
auto coin = data["coin"].get<zora::Zora20Token>();
```

Rate limits and server errors are retried with backoff, honouring `Retry-After`.

## Rewards

```cpp
#include "zora/rewards.hpp"

zora::rewards::MemoryStore store;
zora::rewards::Indexer idx(store);                       // Base's public RPC
auto head = idx.head();
idx.scan({addr}, head - 7 * 43200, head);                // the last 7 days (Base: 43,200 blocks a day)
std::cout << zora::rewards::report_text(store.events_for({addr}), {addr}, &client);
```

Amounts are exact (`zora::rewards::BigUint`). The build also produces a `zora-rewards` example CLI.

## Reference

[Every endpoint and its method](../docs/ENDPOINTS.md), including the units of the numeric fields.

```sh
cmake -S . -B build && cmake --build build && ./build/zora_tests     # offline
LIVE=1 ./build/zora_tests                                            # every endpoint against production
```

MIT © Rebel Studios Software
