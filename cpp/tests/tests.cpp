// zora-coins-cpp tests: a fake transport answering from the shared fixtures (../fixtures).
// LIVE=1 also runs every endpoint against Zora's production API.
#include <cstdlib>
#include <fstream>
#include <functional>
#include <iostream>
#include <sstream>

#include "zora/rewards.hpp"
#include "zora/zora.hpp"

namespace {

int failures = 0, passed = 0;

#define CHECK(cond)                                                                             \
    do {                                                                                        \
        if (!(cond)) {                                                                          \
            std::cerr << "  FAIL " << __func__ << ":" << __LINE__ << ": " #cond << std::endl;  \
            ++failures;                                                                         \
        }                                                                                       \
    } while (0)

std::string fixture(const std::string& name) {
    std::ifstream f(std::string(ZORA_FIXTURES) + "/" + name + ".json");
    std::stringstream s;
    s << f.rdbuf();
    return s.str();
}

struct Call {
    std::string method, url, body, api_key;
};

class Fake : public zora::Transport {
public:
    std::function<zora::HttpResponse(const Call&)> respond;
    std::vector<Call> calls;
    explicit Fake(std::function<zora::HttpResponse(const Call&)> f) : respond(std::move(f)) {}
    zora::HttpResponse send(const std::string& method, const std::string& url, const std::map<std::string, std::string>& headers,
                            const std::string& body, std::chrono::milliseconds) override {
        auto k = headers.find("api-key");
        calls.push_back({method, url, body, k == headers.end() ? "" : k->second});
        return respond(calls.back());
    }
};

zora::HttpResponse ok(const std::string& body) { return {200, {}, body}; }

std::pair<zora::Client, std::shared_ptr<Fake>> client(std::function<zora::HttpResponse(const Call&)> f) {
    auto fake = std::make_shared<Fake>(std::move(f));
    zora::ClientOptions o;
    o.api_key = "k";
    o.base_url = "http://zora.test";
    o.transport = fake;
    o.max_retries = 2;
    return {zora::Client(o), fake};
}

bool has(const std::string& s, const std::string& part) { return s.find(part) != std::string::npos; }

void coin_decodes_a_real_response() {
    auto [c, f] = client([](const Call&) { return ok(fixture("coin")); });
    auto coin = c.coin("0xabc");
    CHECK(coin && coin->name && coin->market_cap);
    CHECK(coin->typename_ && coin->typename_->rfind("GraphQL", 0) == 0);
    CHECK(coin->creator_profile && coin->creator_profile->handle);
    CHECK(has(f->calls[0].url, "chain=8453") && has(f->calls[0].url, "address=0xabc"));
    CHECK(f->calls[0].api_key == "k");
}

void missing_coin_is_empty() {
    auto [c, f] = client([](const Call&) { return ok(fixture("coin_missing")); });
    CHECK(!c.coin("0xdead"));
}

void for_each_follows_cursors_and_stops() {
    auto p2 = nlohmann::json::parse(fixture("explore_page2"));
    p2["exploreList"]["pageInfo"] = {{"hasNextPage", false}};
    auto [c, f] = client([p2](const Call& call) { return ok(has(call.url, "after=") ? p2.dump() : fixture("explore_page1")); });
    int n = 0;
    zora::ExploreParams p;
    p.page_size = 2;
    c.for_each_explore(zora::ListType::TopVolume24h, p, [&](const zora::Zora20Token& t) { n += t.address ? 1 : 0; return true; });
    CHECK(n == 4);
    CHECK(f->calls.size() == 2 && has(f->calls[1].url, "count=2"));
    auto [c2, f2] = client([](const Call&) { return ok(fixture("explore_page1")); });
    c2.for_each_explore(zora::ListType::New, {}, [](const zora::Zora20Token&) { return false; });
    CHECK(f2->calls.size() == 1);
    int m = 0;
    auto [c3, f3] = client([](const Call&) { return ok(fixture("explore_page1")); });
    c3.for_each_explore(zora::ListType::New, {}, [&](const zora::Zora20Token&) { ++m; return true; });
    CHECK(f3->calls.size() == 2 && m == 4);  // a repeated cursor stops it
}

void retries_then_errors() {
    int i = 0;
    auto [c, f] = client([&](const Call&) { return ++i < 3 ? zora::HttpResponse{429, {{"retry-after", "0"}}, "{}"} : ok(fixture("token_info")); });
    CHECK(c.token_info(zora::kUsdcAddress).has_value() && f->calls.size() == 3);
    auto [lim, f2] = client([](const Call&) { return zora::HttpResponse{429, {{"retry-after", "0"}}, R"({"error":"slow down"})"}; });
    try {
        lim.profile("x");
        CHECK(false);
    } catch (const zora::ApiError& e) {
        CHECK(e.is_rate_limited() && has(e.what(), "slow down"));
    }
    auto [thin, f3] = client([](const Call&) { return zora::HttpResponse{422, {}, R"({"success":"false","error":"thin","errorType":"LIQUIDITY"})"}; });
    try {
        thin.quote_trade(zora::Client::eth(), zora::Client::erc20("0xc"), "1", "0xme");
        CHECK(false);
    } catch (const zora::ApiError& e) {
        CHECK(e.is_insufficient_liquidity() && f3->calls.size() == 1);
    }
}

void query_encoding_and_quote() {
    auto [c, f] = client([](const Call&) { return ok(fixture("profile_balances")); });
    zora::ProfileBalancesParams p;
    p.page_size = 7;
    p.sort_option = zora::SortOption::UsdValue;
    p.exclude_hidden = false;
    p.chain_ids = std::vector<std::int64_t>{8453, 7777777};
    auto page = c.profile_balances("jacob", p);
    CHECK(has(f->calls[0].url, "chainIds=8453&chainIds=7777777") && has(f->calls[0].url, "excludeHidden=false") && has(f->calls[0].url, "sortOption=USD_VALUE"));
    CHECK(!page.nodes().empty() && !page.next_cursor().empty());
    auto [q, fq] = client([](const Call&) { return ok(fixture("quote")); });
    auto r = q.quote_trade(zora::Client::eth(), zora::Client::erc20("0xc0"), "1000", "0xme", std::string("0xapp"));
    auto sent = nlohmann::json::parse(fq->calls[0].body);
    CHECK(sent["recipient"] == "0xme" && sent["chainId"] == 8453 && sent["tokenIn"]["type"] == "eth" && !sent["tokenIn"].contains("address"));
    CHECK(r.success.value_or(false) && r.call && r.call->data);
    auto [cs, fc] = client([](const Call&) { return ok(fixture("coins")); });
    CHECK(cs.coins_by_address({"0xAAA", "0xbbb"}).size() == 2);
    CHECK(has(fc->calls[0].url, "coins=%7B%22chainId%22%3A8453%2C%22collectionAddress%22%3A%220xaaa%22%7D"));
}

void every_fixture_decodes_and_unknown_enums_survive() {
    auto coin = nlohmann::json::parse(fixture("coin")).get<zora::CoinResponse>();
    auto holders = nlohmann::json::parse(fixture("coin_holders")).get<zora::CoinHoldersResponse>();
    auto swaps = nlohmann::json::parse(fixture("coin_swaps")).get<zora::CoinSwapsResponse>();
    auto hist = nlohmann::json::parse(fixture("price_history")).get<zora::CoinPriceHistoryResponse>();
    auto search = nlohmann::json::parse(fixture("search")).get<zora::SearchResponse>();
    auto profile = nlohmann::json::parse(fixture("profile")).get<zora::ProfileResponse>();
    CHECK(coin.zora20_token && holders.zora20_token && swaps.zora20_token && hist.zora20_token && search.global_search && profile.profile);
    auto t = nlohmann::json::parse(R"({"coinType":"SOMETHING_NEW"})").get<zora::Zora20Token>();
    CHECK(t.coin_type && t.coin_type->value == "SOMETHING_NEW");
}

void graphql_returns_data_and_throws_on_errors() {
    bool fail = false;
    auto fake = std::make_shared<Fake>([&](const Call&) {
        return ok(fail ? R"({"data":null,"errors":[{"message":"boom"}]})" : R"({"data":{"coin":)" + nlohmann::json::parse(fixture("coin"))["zora20Token"].dump() + "}}");
    });
    zora::ClientOptions o;
    o.transport = fake;
    zora::GraphQLClient gql("http://gw/graphql", o);
    auto data = gql.query("{ coin { name } }");
    CHECK(data["coin"].get<zora::Zora20Token>().name.has_value());
    fail = true;
    try {
        gql.query("{ x }");
        CHECK(false);
    } catch (const std::runtime_error& e) {
        CHECK(has(e.what(), "boom"));
    }
}

void rewards_decode_scan_and_report() {
    auto logs = nlohmann::json::parse(fixture("rewards_v4_logs"));
    auto first = zora::rewards::decode(logs[0]);
    CHECK(first && first->version == 4);
    auto who = first->payouts[zora::rewards::Role::Creator].recipient;
    int calls = 0;
    auto node = std::make_shared<Fake>([&](const Call& c) {
        ++calls;
        auto req = nlohmann::json::parse(c.body);
        if (req["method"] == "eth_blockNumber") {
            std::ostringstream h;
            h << "0x" << std::hex << (first->block + 500);
            return ok(nlohmann::json{{"jsonrpc", "2.0"}, {"id", 1}, {"result", h.str()}}.dump());
        }
        auto lo = std::stoll(req["params"][0]["fromBlock"].get<std::string>().substr(2), nullptr, 16);
        auto hi = std::stoll(req["params"][0]["toBlock"].get<std::string>().substr(2), nullptr, 16);
        if (hi - lo + 1 > 700) return ok(R"({"jsonrpc":"2.0","id":1,"error":{"code":-32600,"message":"block range too large"}})");
        nlohmann::json in = nlohmann::json::array();
        for (const auto& l : logs) {
            auto b = std::stoll(l["blockNumber"].get<std::string>().substr(2), nullptr, 16);
            if (b >= lo && b <= hi) in.push_back(l);
        }
        return ok(nlohmann::json{{"jsonrpc", "2.0"}, {"id", 1}, {"result", in}}.dump());
    });
    zora::rewards::MemoryStore store;
    zora::rewards::Indexer idx(store, "http://node", node);
    std::string upper = who;
    for (size_t i = 2; i < upper.size(); ++i) upper[i] = static_cast<char>(std::toupper(static_cast<unsigned char>(upper[i])));
    int n = idx.scan({upper}, first->block - 1000);
    CHECK(n > 0 && static_cast<int>(store.events_for({who}).size()) == n);
    int before = calls;
    CHECK(idx.scan({who}, first->block - 1000) == 0 && calls - before == 1);
    CHECK(has(zora::rewards::report_text(store.events_for({who}), {who}, nullptr), "Creator payouts"));
    CHECK(zora::rewards::format_usd(0.0042) == "$0.0042" && zora::rewards::format_usd(1234.5) == "$1,234.50");
    CHECK(zora::rewards::BigUint::from_hex("0xffffffffffffffffffffffffffffffff").str() == "340282366920938463463374607431768211455");
}

// Two real logs from one Base trade (tx 0x53f27c…f195): a CreatorCoinRewards payout for a creator coin and a
// CoinMarketRewardsV4 payout for a content coin, both to the same creator.
void rewards_creator_coin_rewards() {
    const std::string creator = "0xf4acf3edc65df843630976459ab1349a88258e6d";
    auto logs = nlohmann::json::parse(fixture("creator_coin_rewards_logs"));
    CHECK(logs[0]["topics"][0] == zora::rewards::kTopicCreatorCoinRewards);
    auto e = zora::rewards::decode(logs[0]);
    CHECK(e && e->version == 4);
    CHECK(e->coin == "0x3177fa60b8a342cd044badf34bf820c536094656" && e->currency == "0x1111111111166b7fe7bd91427724b487980afc69");
    CHECK(e->payouts[zora::rewards::Role::Creator].recipient == creator);
    CHECK(e->payouts[zora::rewards::Role::Creator].currency.str() == "11879451646867555805");
    CHECK(e->payouts[zora::rewards::Role::Protocol].currency.str() == "11879451646867555805");
    CHECK(e->payouts[zora::rewards::Role::PlatformReferrer].recipient == zora::rewards::kZeroAddress);
    auto block = std::stoll(logs[0]["blockNumber"].get<std::string>().substr(2), nullptr, 16);
    std::vector<std::string> asked;
    auto node = std::make_shared<Fake>([&](const Call& c) {
        auto req = nlohmann::json::parse(c.body);
        if (req["method"] == "eth_blockNumber") {
            std::ostringstream h;
            h << "0x" << std::hex << (block + 10);
            return ok(nlohmann::json{{"jsonrpc", "2.0"}, {"id", 1}, {"result", h.str()}}.dump());
        }
        asked.push_back(req["params"][0]["topics"].dump());
        auto lo = std::stoll(req["params"][0]["fromBlock"].get<std::string>().substr(2), nullptr, 16);
        auto hi = std::stoll(req["params"][0]["toBlock"].get<std::string>().substr(2), nullptr, 16);
        nlohmann::json in = nlohmann::json::array();
        for (const auto& l : logs) {
            auto b = std::stoll(l["blockNumber"].get<std::string>().substr(2), nullptr, 16);
            if (b >= lo && b <= hi) in.push_back(l);
        }
        return ok(nlohmann::json{{"jsonrpc", "2.0"}, {"id", 1}, {"result", in}}.dump());
    });
    zora::rewards::MemoryStore store;
    zora::rewards::Indexer idx(store, "http://node", node);
    CHECK(idx.scan({creator}, block - 5) == 2);
    const std::string want = std::string("[[\"") + zora::rewards::kTopicMarketRewardsV4 + "\",\"" + zora::rewards::kTopicCreatorCoinRewards + "\"]]";
    CHECK(!asked.empty());
    for (const auto& t : asked) CHECK(t == want);
}

void live() {
    const char* fv = "0x0b8590d3c0b1ee6c797e184a4afbb15f8f58a46b";
    zora::Client z;
    auto pace = [] { std::this_thread::sleep_for(std::chrono::milliseconds(350)); };
    auto step = [&](const char* name, const std::function<bool()>& f) {
        try {
            if (!f()) {
                std::cerr << "  LIVE FAIL " << name << "\n";
                ++failures;
            }
        } catch (const std::exception& e) {
            std::cerr << "  LIVE FAIL " << name << ": " << e.what() << "\n";
            ++failures;
        }
        pace();
    };
    step("coin", [&] { return z.coin(fv)->name == std::optional<std::string>("FATVANCE64"); });
    step("coins", [&] { return z.coins_by_address({fv}).size() == 1; });
    step("coinHolders", [&] { z.coin_holders(fv); return true; });
    step("coinSwaps", [&] { z.coin_swaps(fv); return true; });
    step("coinComments", [&] { z.coin_comments(fv); return true; });
    step("coinMergedComments", [&] { z.coin_merged_comments(fv); return true; });
    step("coinPriceHistory", [&] { z.coin_price_history(fv); return true; });
    step("coinsList", [&] { zora::CoinsListParams p; p.page_size = 3; return !z.coins_list(p).nodes().empty(); });
    step("tokenInfo", [&] { return z.token_info(zora::kUsdcAddress).has_value(); });
    step("explore", [&] { return !z.explore(zora::ListType::TopGainers).nodes().empty(); });
    step("forEachExplore", [&] {
        int n = 0;
        zora::ExploreParams p;
        p.page_size = 2;
        z.for_each_explore(zora::ListType::TopVolume24h, p, [&](const zora::Zora20Token&) { return ++n < 5; });
        return n == 5;
    });
    step("search", [&] { z.search("zora"); return true; });
    step("trendsByName", [&] { z.trends_by_name("base"); return true; });
    step("traderLeaderboard", [&] { z.trader_leaderboard(); return true; });
    step("featuredCreators", [&] { z.featured_creators(); return true; });
    step("latestLiveStreams", [&] { z.latest_live_streams(); return true; });
    step("topLiveStreams", [&] { z.top_live_streams(); return true; });
    step("creatorLivestreamComments", [&] { z.creator_livestream_comments(fv); return true; });
    step("profile", [&] { return z.profile("rebelstudios")->handle == std::optional<std::string>("rebelstudios"); });
    step("profileCoins", [&] { z.profile_coins("rebelstudios"); return true; });
    step("profileBalances", [&] { z.profile_balances("rebelstudios"); return true; });
    step("profileSocial", [&] { z.profile_social("rebelstudios"); return true; });
    step("walletTradeActivity", [&] { z.wallet_trade_activity("rebelstudios"); return true; });
    step("creatorCoinPoolConfig", [&] { z.creator_coin_pool_config(); return true; });
    step("contentCoinPoolConfig", [&] { z.content_coin_pool_config(zora::CurrencyType::Zora); return true; });
    step("quote", [&] { return z.quote_trade(zora::Client::eth(), zora::Client::erc20(fv), "1000000000000", "0x8E57BFDE053dBb6862991759c19affC5F383d5D0").success.value_or(false); });
    step("missing coin", [&] { return !z.coin("0x000000000000000000000000000000000000dead"); });
}

}  // namespace

int main() {
    const std::pair<const char*, void (*)()> tests[] = {
        {"coin_decodes_a_real_response", coin_decodes_a_real_response}, {"missing_coin_is_empty", missing_coin_is_empty},
        {"for_each_follows_cursors_and_stops", for_each_follows_cursors_and_stops}, {"retries_then_errors", retries_then_errors},
        {"query_encoding_and_quote", query_encoding_and_quote}, {"every_fixture_decodes_and_unknown_enums_survive", every_fixture_decodes_and_unknown_enums_survive},
        {"graphql_returns_data_and_throws_on_errors", graphql_returns_data_and_throws_on_errors}, {"rewards_decode_scan_and_report", rewards_decode_scan_and_report}, {"rewards_creator_coin_rewards", rewards_creator_coin_rewards},
    };
    for (const auto& [name, fn] : tests) {
        int before = failures;
        try {
            fn();
        } catch (const std::exception& e) {
            std::cerr << "  FAIL " << name << ": threw " << e.what() << "\n";
            ++failures;
        }
        if (failures == before) ++passed;
    }
    if (const char* l = std::getenv("LIVE"); l && std::string(l) == "1") {
        int before = failures;
        live();
        if (failures == before) ++passed;
    }
    std::cout << passed << " passed, " << failures << " failed\n";
    return failures ? 1 : 0;
}
