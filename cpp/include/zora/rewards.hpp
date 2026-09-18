// What Zora pays creators and referrers, read straight from Base. Part of zora-coins-cpp.
//
// Every trade of a Zora coin splits its fee between the creator (the payout recipient), the platform
// that launched it, the interface that routed the trade, the protocol, and Doppler. On V4 coins those
// payouts are CoinMarketRewardsV4 events, and none of their fields are indexed, so every event in a
// block range is read and filtered. Scanned ranges are remembered, so a second scan only fetches new
// blocks. Amounts are exact (BigUint), however large.
#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <ctime>
#include <map>
#include <set>
#include <sstream>
#include <string>
#include <vector>

#include "zora/zora.hpp"

namespace zora::rewards {

inline constexpr const char* kTopicMarketRewardsV4 = "0x35b5031218696db1dfd903223a47f38e66a1998e14a942a5d60fddaa49a685fc";
inline constexpr const char* kTopicTradeRewardsV3 = "0x6b67f906562afcdc3afeeeb6754e906cc24d9ce090e9db1b7b68e6462682d966";
inline constexpr const char* kZeroAddress = "0x0000000000000000000000000000000000000000";
inline constexpr std::int64_t kBaseGenesisTimestamp = 1686789347;
inline constexpr const char* kDefaultRpc = "https://mainnet.base.org";
inline constexpr std::int64_t kV4FirstBlock = 31000000;

/// An unsigned integer of any size, for exact token amounts (uint256 and sums of them).
class BigUint {
public:
    BigUint() = default;
    /// From hex digits, with or without 0x.
    static BigUint from_hex(std::string hex) {
        if (hex.rfind("0x", 0) == 0) hex = hex.substr(2);
        BigUint r;
        for (char c : hex) {
            int d = std::isdigit(static_cast<unsigned char>(c)) ? c - '0' : std::tolower(static_cast<unsigned char>(c)) - 'a' + 10;
            r.mul_add(16, static_cast<std::uint32_t>(d));
        }
        return r;
    }
    BigUint& operator+=(const BigUint& o) {
        std::uint64_t carry = 0;
        for (size_t i = 0; i < std::max(limbs_.size(), o.limbs_.size()) || carry; ++i) {
            if (i == limbs_.size()) limbs_.push_back(0);
            std::uint64_t s = carry + limbs_[i] + (i < o.limbs_.size() ? o.limbs_[i] : 0);
            limbs_[i] = static_cast<std::uint32_t>(s % kBase);
            carry = s / kBase;
        }
        return *this;
    }
    bool is_zero() const { return limbs_.empty(); }
    /// Decimal digits.
    std::string str() const {
        if (limbs_.empty()) return "0";
        std::string out = std::to_string(limbs_.back());
        char buf[16];
        for (size_t i = limbs_.size() - 1; i-- > 0;) {
            std::snprintf(buf, sizeof buf, "%09u", limbs_[i]);
            out += buf;
        }
        return out;
    }
    /// As a double, divided by 10^decimals.
    double scaled(int decimals) const { return std::stod(str()) / std::pow(10.0, decimals); }

private:
    static constexpr std::uint64_t kBase = 1000000000;  // base 1e9 limbs, least significant first
    void mul_add(std::uint32_t m, std::uint32_t a) {
        std::uint64_t carry = a;
        for (auto& l : limbs_) {
            std::uint64_t v = static_cast<std::uint64_t>(l) * m + carry;
            l = static_cast<std::uint32_t>(v % kBase);
            carry = v / kBase;
        }
        while (carry) {
            limbs_.push_back(static_cast<std::uint32_t>(carry % kBase));
            carry /= kBase;
        }
    }
    std::vector<std::uint32_t> limbs_;
};

/// Who a payout goes to, in report order.
enum class Role { Creator, PlatformReferrer, TradeReferrer, Protocol, Doppler };
inline const char* label(Role r) {
    static const char* names[] = {"Creator payouts", "Platform referral", "Trade referral", "Protocol", "Doppler"};
    return names[static_cast<int>(r)];
}

/// What one role received: currency in the event's currency, coin in the traded coin.
struct Payout {
    std::string recipient;
    BigUint currency, coin;
};

/// One reward distribution.
struct Event {
    std::int64_t block = 0;
    std::string tx_hash;
    std::int64_t log_index = 0;
    int version = 0;
    std::string coin, currency;
    std::map<Role, Payout> payouts;
    std::int64_t timestamp() const { return kBaseGenesisTimestamp + 2 * block; }
    bool pays(const std::set<std::string>& who) const {
        for (const auto& [r, p] : payouts)
            if (p.recipient != kZeroAddress && who.count(p.recipient)) return true;
        return false;
    }
};

namespace detail {
inline std::string lower(std::string s) {
    for (auto& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return s;
}
inline std::string word(const std::string& data, int i) {
    size_t a = 2 + static_cast<size_t>(i) * 64;
    return data.size() >= a + 64 ? data.substr(a, 64) : "";
}
inline std::string addr(const std::string& w) { return w.size() >= 40 ? "0x" + lower(w.substr(w.size() - 40)) : kZeroAddress; }
inline std::int64_t hex(const std::string& s) { return std::stoll(s.rfind("0x", 0) == 0 ? s.substr(2) : s, nullptr, 16); }
}  // namespace detail

/// Decode an eth_getLogs entry, or nullopt if it isn't a Zora reward event.
inline std::optional<Event> decode(const nlohmann::json& log) {
    if (!log.contains("topics") || log["topics"].empty()) return std::nullopt;
    auto t0 = detail::lower(log["topics"][0].get<std::string>());
    std::string data = log.value("data", std::string("0x"));
    int words = static_cast<int>((data.size() - 2) / 64);
    Event e;
    e.block = detail::hex(log.value("blockNumber", std::string("0x0")));
    e.tx_hash = detail::lower(log.value("transactionHash", std::string()));
    e.log_index = detail::hex(log.value("logIndex", std::string("0x0")));
    auto w = [&](int i) { return detail::word(data, i); };
    if (t0 == kTopicMarketRewardsV4 && words >= 17) {
        e.version = 4;
        e.coin = detail::addr(w(0));
        e.currency = detail::addr(w(1));
        const Role roles[] = {Role::Creator, Role::PlatformReferrer, Role::TradeReferrer, Role::Protocol, Role::Doppler};
        for (int i = 0; i < 5; ++i) e.payouts[roles[i]] = {detail::addr(w(2 + i)), BigUint::from_hex(w(7 + 2 * i)), BigUint::from_hex(w(8 + 2 * i))};
        return e;
    }
    if (t0 == kTopicTradeRewardsV3 && log["topics"].size() >= 4 && words >= 6) {
        auto topic = [&](int i) { return detail::addr(log["topics"][i].get<std::string>().substr(2)); };
        e.version = 3;
        e.coin = detail::lower(log.value("address", std::string()));
        e.currency = detail::addr(w(5));
        e.payouts[Role::Creator] = {topic(1), BigUint::from_hex(w(1)), {}};
        e.payouts[Role::PlatformReferrer] = {topic(2), BigUint::from_hex(w(2)), {}};
        e.payouts[Role::TradeReferrer] = {topic(3), BigUint::from_hex(w(3)), {}};
        e.payouts[Role::Protocol] = {detail::addr(w(0)), BigUint::from_hex(w(4)), {}};
        e.payouts[Role::Doppler] = {kZeroAddress, {}, {}};
        return e;
    }
    return std::nullopt;
}

/// Indexed events and scanned block ranges, in memory.
class MemoryStore {
public:
    void save(const std::vector<Event>& events, const std::vector<std::string>& who, std::int64_t from, std::int64_t to) {
        for (const auto& e : events) events_[e.tx_hash + ":" + std::to_string(e.log_index)] = e;
        for (const auto& a : who) {
            auto& r = scans_[a];
            r.emplace_back(from, to);
            r = merge(r);
        }
    }
    std::vector<std::pair<std::int64_t, std::int64_t>> scanned(const std::string& a) const {
        auto it = scans_.find(a);
        return it == scans_.end() ? std::vector<std::pair<std::int64_t, std::int64_t>>{} : it->second;
    }
    /// Stored events paying any of the addresses, oldest first.
    std::vector<Event> events_for(const std::vector<std::string>& addresses) const {
        std::set<std::string> who;
        for (const auto& a : addresses) who.insert(detail::lower(a));
        std::vector<Event> out;
        for (const auto& [k, e] : events_)
            if (e.pays(who)) out.push_back(e);
        std::sort(out.begin(), out.end(), [](const Event& a, const Event& b) { return a.block != b.block ? a.block < b.block : a.log_index < b.log_index; });
        return out;
    }
    static std::vector<std::pair<std::int64_t, std::int64_t>> merge(std::vector<std::pair<std::int64_t, std::int64_t>> r) {
        std::sort(r.begin(), r.end());
        std::vector<std::pair<std::int64_t, std::int64_t>> out;
        for (const auto& x : r) {
            if (!out.empty() && x.first <= out.back().second + 1) out.back().second = std::max(out.back().second, x.second);
            else out.push_back(x);
        }
        return out;
    }

private:
    std::map<std::string, Event> events_;
    std::map<std::string, std::vector<std::pair<std::int64_t, std::int64_t>>> scans_;
};

/// Finds reward events paying a set of addresses. Uses the same Transport as the client.
class Indexer {
public:
    explicit Indexer(MemoryStore& store, std::string rpc = kDefaultRpc, std::shared_ptr<Transport> transport = nullptr)
        : store_(store), rpc_(std::move(rpc)), transport_(transport ? std::move(transport) : make_curl_transport()) {}

    /// Blocks per eth_getLogs (halved automatically when a node refuses a range).
    std::int64_t step = 2000;

    /// Index rewards paid to `addresses` from `from_block` (0 = V4 start) to `to_block` (0 = head).
    /// Returns how many new matching events were stored.
    int scan(const std::vector<std::string>& addresses, std::int64_t from_block = 0, std::int64_t to_block = 0) {
        std::vector<std::string> who;
        for (const auto& a : addresses) {
            auto l = detail::lower(a);
            if (l.size() != 42 || l.rfind("0x", 0) != 0) throw std::invalid_argument(a + " is not an address");
            if (std::find(who.begin(), who.end(), l) == who.end()) who.push_back(l);
        }
        std::int64_t head = to_block ? to_block : this->head();
        std::int64_t lo = std::max(from_block, kV4FirstBlock);
        std::vector<std::pair<std::int64_t, std::int64_t>> gaps;
        for (const auto& a : who) {
            std::int64_t cur = lo;
            for (const auto& [x, y] : store_.scanned(a)) {
                if (y < cur || x > head) continue;
                if (x > cur) gaps.emplace_back(cur, x - 1);
                cur = std::max(cur, y + 1);
            }
            if (cur <= head) gaps.emplace_back(cur, head);
        }
        std::set<std::string> watch(who.begin(), who.end());
        int found = 0;
        for (const auto& [a, b] : MemoryStore::merge(gaps)) {
            std::int64_t s = step;
            for (std::int64_t from = a; from <= b;) {
                std::int64_t to = std::min(from + s - 1, b);
                nlohmann::json logs;
                try {
                    logs = call("eth_getLogs", nlohmann::json::array({{{"fromBlock", to_hex(from)}, {"toBlock", to_hex(to)}, {"topics", {kTopicMarketRewardsV4}}}}));
                } catch (const std::runtime_error& e) {
                    std::string m = detail::lower(e.what());
                    if (m.find("rate") == std::string::npos && (m.find("range") != std::string::npos || m.find("too many") != std::string::npos) && s > 50) {
                        s /= 2;  // this node caps log ranges or result sizes: retry the chunk smaller
                        continue;
                    }
                    throw;
                }
                std::vector<Event> mine;
                for (const auto& l : logs)
                    if (auto e = decode(l); e && e->pays(watch)) mine.push_back(*e);
                store_.save(mine, who, from, to);
                found += static_cast<int>(mine.size());
                from = to + 1;
            }
        }
        return found;
    }

    /// The latest block number.
    std::int64_t head() { return detail::hex(call("eth_blockNumber", nlohmann::json::array()).get<std::string>()); }

private:
    static std::string to_hex(std::int64_t v) {
        std::ostringstream s;
        s << "0x" << std::hex << v;
        return s.str();
    }
    nlohmann::json call(const std::string& method, const nlohmann::json& params) {
        std::string body = nlohmann::json{{"jsonrpc", "2.0"}, {"id", 1}, {"method", method}, {"params", params}}.dump();
        for (int attempt = 0;; ++attempt) {
            HttpResponse r = transport_->send("POST", rpc_, {{"Content-Type", "application/json"}}, body, std::chrono::seconds(60));
            bool retry = r.status == 429 || r.status >= 500;
            auto j = nlohmann::json::parse(r.body, nullptr, false);
            std::string msg = !j.is_discarded() && j.contains("error") ? j["error"].value("message", std::string()) : "";
            if ((retry || detail::lower(msg).find("rate") != std::string::npos) && attempt < 5) {
                std::this_thread::sleep_for(std::chrono::seconds(std::min(1 << (attempt + 1), 20)));
                continue;
            }
            if (retry) throw std::runtime_error("rpc " + method + ": HTTP " + std::to_string(r.status));
            if (!msg.empty() || j.is_discarded()) throw std::runtime_error("rpc " + method + ": " + msg);
            return j["result"];
        }
    }
    MemoryStore& store_;
    std::string rpc_;
    std::shared_ptr<Transport> transport_;
};

/// $1,234.56, or $0.0042 below a cent.
inline std::string format_usd(double x) {
    char buf[64];
    if (std::fabs(x) >= 0.01 || x == 0) {
        std::snprintf(buf, sizeof buf, "%.2f", x);
        std::string s = buf, whole = s.substr(0, s.find('.')), frac = s.substr(s.find('.'));
        std::string out;
        int n = 0;
        for (auto it = whole.rbegin(); it != whole.rend(); ++it, ++n) {
            if (n && n % 3 == 0 && *it != '-') out.insert(out.begin(), ',');
            out.insert(out.begin(), *it);
        }
        return "$" + out + frac;
    }
    std::snprintf(buf, sizeof buf, "%.4g", x);
    return std::string("$") + buf;
}

/// Plain-text earnings report for `addresses`, priced with `client` (nullptr skips pricing).
inline std::string report_text(const std::vector<Event>& events, const std::vector<std::string>& addresses, Client* client) {
    std::set<std::string> who;
    for (const auto& a : addresses) who.insert(detail::lower(a));
    std::map<std::pair<int, std::string>, std::pair<BigUint, int>> sums;
    for (const auto& e : events)
        for (const auto& [role, p] : e.payouts) {
            if (!who.count(p.recipient)) continue;
            for (const auto& [token, raw] : {std::pair{e.currency, p.currency}, std::pair{e.coin.empty() ? std::string(kZeroAddress) : e.coin, p.coin}}) {
                if (raw.is_zero()) continue;
                auto& s = sums[{static_cast<int>(role), token}];
                s.first += raw;
                s.second += 1;
            }
        }
    std::ostringstream out;
    out << "Zora rewards for ";
    for (auto it = who.begin(); it != who.end(); ++it) out << (it == who.begin() ? "" : ", ") << *it;
    out << "\n" << events.size() << " reward events\n";
    double total = 0;
    for (const auto& [key, v] : sums) {
        const std::string& token = key.second;
        std::string symbol = token == kZeroAddress ? "ETH" : token == kUsdcAddress ? "USDC" : token.substr(0, 8) + "…";
        int decimals = token == kUsdcAddress ? 6 : 18;
        std::optional<double> price = token == kUsdcAddress ? std::optional<double>(1.0) : std::nullopt;
        if (client) {
            try {
                if (auto info = client->token_info(token == kZeroAddress ? kWethAddress : token); info && info->currency) {
                    const auto& c = *info->currency;
                    if (c.symbol && token != kZeroAddress) symbol = *c.symbol;
                    if (c.decimals) decimals = static_cast<int>(*c.decimals);
                    if (c.price_usd) price = std::stod(*c.price_usd);
                }
            } catch (const std::exception&) {
                // unpriced
            }
        }
        double amount = v.first.scaled(decimals);
        char line[256];
        std::string usd = price ? format_usd(amount * *price) : "—";
        if (price) total += amount * *price;
        std::snprintf(line, sizeof line, "  %-18s %16.6g %-12s %12s  (%d payouts)\n", label(static_cast<Role>(key.first)), amount, symbol.c_str(), usd.c_str(), v.second);
        out << line;
    }
    char line[128];
    std::snprintf(line, sizeof line, "  %-18s %16s %-12s %12s\n", "Total (current prices)", "", "", format_usd(total).c_str());
    out << line;
    return out.str();
}

}  // namespace zora::rewards
