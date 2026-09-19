// zora-coins-cpp: a typed client for the Zora Coins API (all 30 endpoints), a GraphQL client, and an
// onchain indexer for Zora creator and referral rewards on Base. Unofficial; not affiliated with Zora.
//
//     zora::Client client;                                   // reads ZORA_API_KEY
//     if (auto coin = client.coin("0x0b8590d3c0b1ee6c797e184a4afbb15f8f58a46b")) {
//         std::cout << coin->name.value_or("") << " " << coin->market_cap.value_or("") << "\n";
//     }
//     client.for_each_explore(zora::ListType::TopGainers, {}, [](const zora::Zora20Token& c) {
//         std::cout << c.symbol.value_or("") << "\n";
//         return true;                                        // false stops early
//     });
#pragma once

#include <chrono>
#include <cstdint>
#include <cstdlib>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <random>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <utility>
#include <vector>

#include <nlohmann/json.hpp>

#include "zora/endpoints.hpp"
#include "zora/models.hpp"
#include "zora/transport.hpp"

namespace zora {

/// Zora's production REST API.
inline constexpr const char* kDefaultBaseUrl = "https://api-sdk.zora.engineering";
/// Base mainnet, where Zora coins live. Every call defaults to it.
inline constexpr std::int64_t kBaseChainId = 8453;
/// WETH, USDC and ZORA on Base.
inline constexpr const char* kWethAddress = "0x4200000000000000000000000000000000000006";
inline constexpr const char* kUsdcAddress = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
inline constexpr const char* kZoraAddress = "0x1111111111166b7fe7bd91427724b487980afc69";
inline constexpr const char* kVersion = "0.1.1";

/// The Zora API answered with an HTTP error after retries were used up.
class ApiError : public std::runtime_error {
public:
    ApiError(int status, const std::string& message, std::string path, std::string error_type, std::string body)
        : std::runtime_error("zora " + path + ": " + std::to_string(status) + " " + message),
          status_(status), path_(std::move(path)), error_type_(std::move(error_type)), body_(std::move(body)) {}
    /// HTTP status.
    int status() const { return status_; }
    /// The endpoint, e.g. "/coin".
    const std::string& path() const { return path_; }
    /// The API's machine-readable reason, where it gives one: /quote answers 422 with "LIQUIDITY".
    const std::string& error_type() const { return error_type_; }
    /// The raw response body.
    const std::string& body() const { return body_; }
    /// Whether Zora refused the request for exceeding its rate limit. An API key raises it.
    bool is_rate_limited() const { return status_ == 429; }
    /// Whether a quote failed because the pool can't fill a trade that size. Try a smaller amount.
    bool is_insufficient_liquidity() const { return error_type_ == "LIQUIDITY"; }

private:
    int status_;
    std::string path_, error_type_, body_;
};

namespace detail {

inline std::string url_encode(const std::string& s) {
    std::ostringstream out;
    static const char* hex = "0123456789ABCDEF";
    for (unsigned char c : s) {
        if (std::isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~') out << c;
        else out << '%' << hex[c >> 4] << hex[c & 15];
    }
    return out.str();
}

/// A query string with repeated keys allowed.
struct Query {
    std::vector<std::pair<std::string, std::string>> pairs;
    void add(const std::string& k, const std::string& v) { pairs.emplace_back(k, v); }
    std::string encode() const {
        std::string out;
        for (const auto& [k, v] : pairs) out += (out.empty() ? "" : "&") + url_encode(k) + "=" + url_encode(v);
        return out;
    }
};

inline std::string format(const std::string& v) { return v; }
inline std::string format(bool v) { return v ? "true" : "false"; }
inline std::string format(std::int64_t v) { return std::to_string(v); }
inline std::string format(int v) { return std::to_string(v); }
inline std::string format(double v) {
    std::ostringstream s;
    s << v;
    return s.str();
}
template <typename E, typename = decltype(std::declval<E>().value)>
std::string format(const E& e) { return e.value; }

}  // namespace detail

/// Options for Client.
struct ClientOptions {
    /// API key sent as the api-key header (default: ZORA_API_KEY). Create one at https://zora.co/settings/developer.
    std::optional<std::string> api_key;
    /// Another deployment (staging, a mock server in tests).
    std::string base_url = kDefaultBaseUrl;
    /// Retries for rate limits (429) and server errors (5xx).
    int max_retries = 3;
    /// Per-request timeout.
    std::chrono::milliseconds timeout{30000};
    /// Your own HTTP stack; defaults to libcurl.
    std::shared_ptr<Transport> transport;
    /// Prefix for the User-Agent header.
    std::string user_agent;
};

/// Client for the Zora Coins API: one method per endpoint and a for_each_… for every paginated one.
/// Rate limits and server errors are retried with backoff, honouring Retry-After; what's left throws
/// ApiError. Lookups that find nothing return an empty optional. Safe to share across threads.
class Client {
public:
    explicit Client(ClientOptions options = {}) : opt_(std::move(options)) {
        if (!opt_.api_key) {
            if (const char* k = std::getenv("ZORA_API_KEY"); k && *k) opt_.api_key = k;
        }
        if (!opt_.transport) opt_.transport = make_curl_transport();
        while (!opt_.base_url.empty() && opt_.base_url.back() == '/') opt_.base_url.pop_back();
        ua_ = (opt_.user_agent.empty() ? "" : opt_.user_agent + " ") + "zora-coins-cpp/" + kVersion;
    }

#include "zora/client_methods.inc"

    /// Native ETH as a trade input or output.
    static TokenSpecInput eth() {
        TokenSpecInput t{};
        t.type_ = TokenType::Eth;
        return t;
    }
    /// An ERC-20 (a Zora coin, ZORA, USDC…) as a trade input or output.
    static TokenSpecInput erc20(const std::string& address) {
        TokenSpecInput t{};
        t.type_ = TokenType::Erc20;
        t.address = address;
        return t;
    }

    /// Several coins on Base by contract address, in one request.
    std::vector<Zora20Token> coins_by_address(const std::vector<std::string>& addresses) {
        std::vector<CoinRefInput> refs;
        for (auto a : addresses) {
            for (auto& ch : a) ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
            CoinRefInput ref{};
            ref.chain_id = kBaseChainId;
            ref.collection_address = a;
            refs.push_back(ref);
        }
        return coins(refs);
    }

    /// quote() with the usual defaults: recipient = sender, 5% slippage, chain Base. amount_in is in the
    /// input token's smallest unit (wei for ETH). Nothing is signed or sent: give result.call to your wallet.
    QuoteResponse quote_trade(const TokenSpecInput& in, const TokenSpecInput& out, const std::string& amount_in,
                              const std::string& sender, std::optional<std::string> referrer = std::nullopt) {
        QuoteRequest r{};
        r.token_in = in;
        r.token_out = out;
        r.amount_in = amount_in;
        r.sender = sender;
        r.recipient = sender;
        r.slippage = 0.05;
        r.chain_id = kBaseChainId;
        r.referrer = std::move(referrer);
        return quote(r);
    }

    /// Send one request and parse the JSON response into T. The generated methods are built on this.
    template <typename T>
    T send(const std::string& method, const std::string& path, const detail::Query& q, const std::string& body) {
        std::string qs = q.encode();
        std::string url = opt_.base_url + path + (qs.empty() ? "" : "?" + qs);
        std::map<std::string, std::string> headers{{"Accept", "application/json"}, {"User-Agent", ua_}};
        if (opt_.api_key && !opt_.api_key->empty()) headers["api-key"] = *opt_.api_key;
        if (!body.empty()) headers["Content-Type"] = "application/json";
        for (int attempt = 0;; ++attempt) {
            HttpResponse resp;
            try {
                resp = opt_.transport->send(method, url, headers, body, opt_.timeout);
            } catch (const std::runtime_error&) {
                if (attempt >= opt_.max_retries) throw;
                std::this_thread::sleep_for(backoff(attempt, ""));
                continue;
            }
            bool retry = resp.status == 429 || resp.status == 500 || resp.status == 502 || resp.status == 503 || resp.status == 504;
            if (retry && attempt < opt_.max_retries) {
                auto ra = resp.headers.find("retry-after");
                std::this_thread::sleep_for(backoff(attempt, ra == resp.headers.end() ? "" : ra->second));
                continue;
            }
            if (resp.status >= 400) throw api_error(resp, path);
            if (resp.body.empty()) return T{};
            return nlohmann::json::parse(resp.body).get<T>();
        }
    }

private:
    static std::chrono::milliseconds backoff(int attempt, const std::string& retry_after) {
        if (!retry_after.empty()) {
            try {
                return std::chrono::milliseconds(static_cast<long long>(std::min(std::stod(retry_after), 30.0) * 1000));
            } catch (const std::exception&) {
                // an HTTP date: fall through
            }
        }
        thread_local std::mt19937 rng{std::random_device{}()};
        return std::chrono::milliseconds(std::min(1 << attempt, 16) * 500 + std::uniform_int_distribution<int>(0, 249)(rng));
    }

    static ApiError api_error(const HttpResponse& r, const std::string& path) {
        std::string message = "HTTP " + std::to_string(r.status), type;
        auto j = nlohmann::json::parse(r.body, nullptr, false);
        if (!j.is_discarded() && j.is_object()) {
            if (j.contains("message") && j["message"].is_string()) message = j["message"];
            else if (j.contains("error") && j["error"].is_string()) message = j["error"];
            if (j.contains("errorType") && j["errorType"].is_string()) type = j["errorType"];
        } else if (!r.body.empty()) {
            message = r.body.substr(0, 300);
        }
        return ApiError(r.status, message, path, type, r.body);
    }

    ClientOptions opt_;
    std::string ua_;
};

#include "zora/client_impl.inc"

/// Client for the zora-coins GraphQL gateway: the whole Zora Coins API as one schema. Results convert
/// into the same model structs as REST.
class GraphQLClient {
public:
    explicit GraphQLClient(const std::string& endpoint, ClientOptions options = {}) {
        options.base_url = endpoint;
        client_ = std::make_unique<Client>(std::move(options));
    }

    /// Run a query and return its data. Throws std::runtime_error with the messages if the gateway reports errors.
    nlohmann::json query(const std::string& query, const nlohmann::json& variables = nlohmann::json::object()) {
        auto resp = client_->send<nlohmann::json>("POST", "", {}, nlohmann::json{{"query", query}, {"variables", variables}}.dump());
        if (resp.contains("errors") && resp["errors"].is_array() && !resp["errors"].empty()) {
            std::string msg = "zora graphql:";
            for (const auto& e : resp["errors"]) msg += " " + e.value("message", std::string("error")) + ";";
            throw std::runtime_error(msg);
        }
        return resp.value("data", nlohmann::json());
    }

private:
    std::unique_ptr<Client> client_;
};

}  // namespace zora
