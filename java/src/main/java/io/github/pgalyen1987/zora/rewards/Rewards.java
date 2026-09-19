package io.github.pgalyen1987.zora.rewards;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.JsonNode;
import io.github.pgalyen1987.zora.Transport;
import io.github.pgalyen1987.zora.ZoraApiException;
import io.github.pgalyen1987.zora.ZoraCoins;
import io.github.pgalyen1987.zora.internal.Json;
import io.github.pgalyen1987.zora.model.Currency;
import io.github.pgalyen1987.zora.model.Erc20Token;
import java.io.IOException;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeMap;
import java.util.function.Consumer;

/**
 * What Zora pays creators and referrers, read straight from Base.
 *
 * <p>Every trade of a Zora coin splits its fee between the creator (the payout recipient), the platform that
 * launched the coin, the interface that routed the trade, the protocol, and Doppler. On V4 coins those payouts
 * are CoinMarketRewardsV4 events, and none of their fields are indexed, so every event in a block range is read
 * and filtered. Ranges already scanned are remembered, so a second scan only fetches new blocks.
 *
 * <pre>{@code
 * Rewards.Indexer idx = new Rewards.Indexer(new Rewards.MemoryStore(), null, null);
 * idx.scan(List.of("0xYourAddress"), null, 7.0, null, null);
 * Rewards.Report r = Rewards.Report.build(idx.store().eventsFor(List.of("0xYourAddress"), 0), List.of("0xYourAddress"), ZoraCoins.builder().build());
 * System.out.print(r.toText());
 * }</pre>
 */
public final class Rewards {
    /** keccak256 of CoinMarketRewardsV4(address,address,address,address,address,address,address,(uint256×10)). */
    public static final String TOPIC_MARKET_REWARDS_V4 = "0x35b5031218696db1dfd903223a47f38e66a1998e14a942a5d60fddaa49a685fc";
    /** keccak256 of CoinTradeRewards(address,address,address,address,uint256,uint256,uint256,uint256,address). */
    public static final String TOPIC_TRADE_REWARDS_V3 = "0x6b67f906562afcdc3afeeeb6754e906cc24d9ce090e9db1b7b68e6462682d966";
    /**
     * keccak256 of CreatorCoinRewards(address,address,address,address,uint256,uint256): the V4 hooks' payout on
     * creator-coin trades, the creator's and the protocol's shares. The coin is indexed, the rest is not. In a sample
     * day on Base it carried about a third of all payouts and nearly half of what creators earned.
     */
    public static final String TOPIC_CREATOR_COIN_REWARDS = "0xea92473287be4e55f8279d0b8395a45960a217ae2f1a76ac9cae84af58a751ed";
    /** "Nobody" in a recipient field; native ETH as a currency. */
    public static final String ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
    /** Unix time of Base's genesis block; Base makes a block exactly every 2 seconds. */
    public static final long BASE_GENESIS_TIMESTAMP = 1686789347L;
    /** Base's public JSON-RPC endpoint. */
    public static final String DEFAULT_RPC = "https://mainnet.base.org";
    /** No CoinMarketRewardsV4 events exist before this block (2025-06-01). */
    public static final long V4_FIRST_BLOCK = 31_000_000L;

    private Rewards() {}

    /** Who a payout goes to. */
    public enum Role {
        /** The coin's payout recipient. */
        CREATOR("Creator payouts"),
        /** The app that launched the coin. */
        PLATFORM_REFERRER("Platform referral"),
        /** The interface that routed the trade. */
        TRADE_REFERRER("Trade referral"),
        /** Zora's protocol fee. */
        PROTOCOL("Protocol"),
        /** Doppler's share. */
        DOPPLER("Doppler");

        private final String label;

        Role(String label) {
            this.label = label;
        }

        /** Human name. */
        public String label() {
            return label;
        }
    }

    /** What one role received in one event: currency in the event's currency, coin in the traded coin. */
    public static final class Payout {
        /** Who was paid. */
        public final String recipient;
        /** Amount in the event's currency, smallest unit. */
        public final BigInteger currency;
        /** Amount in the coin, smallest unit. */
        public final BigInteger coin;

        Payout(String recipient, BigInteger currency, BigInteger coin) {
            this.recipient = recipient;
            this.currency = currency;
            this.coin = coin;
        }
    }

    /** One reward distribution. */
    public static final class Event {
        /** Block number. */
        public final long block;
        /** Transaction hash. */
        public final String txHash;
        /** Log index. */
        public final long logIndex;
        /** 4 or 3. */
        public final int version;
        /** The traded coin. */
        public final String coin;
        /** The currency the currency amounts are in. */
        public final String currency;
        /** What each role received. */
        public final Map<Role, Payout> payouts;

        Event(long block, String txHash, long logIndex, int version, String coin, String currency, Map<Role, Payout> payouts) {
            this.block = block;
            this.txHash = txHash;
            this.logIndex = logIndex;
            this.version = version;
            this.coin = coin;
            this.currency = currency;
            this.payouts = Collections.unmodifiableMap(payouts);
        }

        /** Unix time of the block. */
        public long timestamp() {
            return BASE_GENESIS_TIMESTAMP + 2 * block;
        }

        String key() {
            return txHash + ":" + logIndex;
        }

        boolean pays(Set<String> addresses) {
            for (Payout p : payouts.values()) if (!ZERO_ADDRESS.equals(p.recipient) && addresses.contains(p.recipient)) return true;
            return false;
        }
    }

    /** An eth_getLogs entry. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static final class Log {
        /** Emitting contract. */
        public String address = "";
        /** Indexed topics. */
        public List<String> topics = new ArrayList<>();
        /** Non-indexed data (0x hex). */
        public String data = "0x";
        /** Block number (0x hex). */
        public String blockNumber = "0x0";
        /** Transaction hash. */
        public String transactionHash = "";
        /** Log index (0x hex). */
        public String logIndex = "0x0";
    }

    private static String word(String data, int i) {
        int a = 2 + i * 64;
        return data.length() >= a + 64 ? data.substring(a, a + 64) : "";
    }

    private static String addr(String w) {
        return w.length() >= 40 ? "0x" + w.substring(w.length() - 40).toLowerCase(Locale.ROOT) : ZERO_ADDRESS;
    }

    private static BigInteger uint(String w) {
        return w.isEmpty() ? BigInteger.ZERO : new BigInteger(w, 16);
    }

    static long hex(String s) {
        return Long.parseLong(s.startsWith("0x") ? s.substring(2) : s, 16);
    }

    /** Left-pad an address to a 32-byte topic. */
    public static String addressTopic(String address) {
        return "0x" + "0".repeat(24) + address.toLowerCase(Locale.ROOT).replace("0x", "");
    }

    /** Decode a log, or empty if it isn't a Zora reward event. */
    public static Optional<Event> decode(Log l) {
        if (l.topics.isEmpty()) return Optional.empty();
        String t0 = l.topics.get(0).toLowerCase(Locale.ROOT);
        int words = (l.data.length() - 2) / 64;
        long block = hex(l.blockNumber), index = hex(l.logIndex);
        String tx = l.transactionHash.toLowerCase(Locale.ROOT), emitter = l.address.toLowerCase(Locale.ROOT);
        Map<Role, Payout> p = new EnumMap<>(Role.class);
        if (t0.equals(TOPIC_MARKET_REWARDS_V4) && words >= 17) {
            Role[] roles = Role.values();
            for (int i = 0; i < roles.length; i++) {
                p.put(roles[i], new Payout(addr(word(l.data, 2 + i)), uint(word(l.data, 7 + 2 * i)), uint(word(l.data, 8 + 2 * i))));
            }
            return Optional.of(new Event(block, tx, index, 4, addr(word(l.data, 0)), addr(word(l.data, 1)), p));
        }
        if (t0.equals(TOPIC_CREATOR_COIN_REWARDS) && l.topics.size() >= 2 && words >= 5) {
            // coin (indexed), then currency, creator, protocol, creator amount, protocol amount
            p.put(Role.CREATOR, new Payout(addr(word(l.data, 1)), uint(word(l.data, 3)), BigInteger.ZERO));
            p.put(Role.PLATFORM_REFERRER, new Payout(ZERO_ADDRESS, BigInteger.ZERO, BigInteger.ZERO));
            p.put(Role.TRADE_REFERRER, new Payout(ZERO_ADDRESS, BigInteger.ZERO, BigInteger.ZERO));
            p.put(Role.PROTOCOL, new Payout(addr(word(l.data, 2)), uint(word(l.data, 4)), BigInteger.ZERO));
            p.put(Role.DOPPLER, new Payout(ZERO_ADDRESS, BigInteger.ZERO, BigInteger.ZERO));
            return Optional.of(new Event(block, tx, index, 4, addr(l.topics.get(1).replace("0x", "")), addr(word(l.data, 0)), p));
        }
        if (t0.equals(TOPIC_TRADE_REWARDS_V3) && l.topics.size() >= 4 && words >= 6) {
            p.put(Role.CREATOR, new Payout(addr(l.topics.get(1).replace("0x", "")), uint(word(l.data, 1)), BigInteger.ZERO));
            p.put(Role.PLATFORM_REFERRER, new Payout(addr(l.topics.get(2).replace("0x", "")), uint(word(l.data, 2)), BigInteger.ZERO));
            p.put(Role.TRADE_REFERRER, new Payout(addr(l.topics.get(3).replace("0x", "")), uint(word(l.data, 3)), BigInteger.ZERO));
            p.put(Role.PROTOCOL, new Payout(addr(word(l.data, 0)), uint(word(l.data, 4)), BigInteger.ZERO));
            p.put(Role.DOPPLER, new Payout(ZERO_ADDRESS, BigInteger.ZERO, BigInteger.ZERO));
            return Optional.of(new Event(block, tx, index, 3, emitter, addr(word(l.data, 5)), p));
        }
        return Optional.empty();
    }

    /** Indexed events and scanned ranges, in memory. Thread-safe. */
    public static final class MemoryStore {
        private final Map<String, Event> events = new LinkedHashMap<>();
        private final Map<String, List<long[]>> scans = new HashMap<>();

        /** Store events and record that [from, to] was scanned for the addresses. */
        public synchronized void save(List<Event> found, List<String> addresses, long from, long to) {
            for (Event e : found) events.put(e.key(), e);
            for (String a : addresses) {
                List<long[]> l = scans.computeIfAbsent(a.toLowerCase(Locale.ROOT), k -> new ArrayList<>());
                l.add(new long[] {from, to});
                scans.put(a.toLowerCase(Locale.ROOT), merge(l));
            }
        }

        /** Merged ranges already scanned for an address. */
        public synchronized List<long[]> scanned(String address) {
            return new ArrayList<>(scans.getOrDefault(address.toLowerCase(Locale.ROOT), Collections.emptyList()));
        }

        /** Stored events paying any of the addresses, from sinceBlock, oldest first. */
        public synchronized List<Event> eventsFor(List<String> addresses, long sinceBlock) {
            Set<String> watch = new HashSet<>();
            for (String a : addresses) watch.add(a.toLowerCase(Locale.ROOT));
            List<Event> out = new ArrayList<>();
            for (Event e : events.values()) if (e.block >= sinceBlock && e.pays(watch)) out.add(e);
            out.sort((x, y) -> x.block != y.block ? Long.compare(x.block, y.block) : Long.compare(x.logIndex, y.logIndex));
            return out;
        }
    }

    static List<long[]> merge(List<long[]> ranges) {
        List<long[]> sorted = new ArrayList<>(ranges);
        sorted.sort((a, b) -> Long.compare(a[0], b[0]));
        List<long[]> out = new ArrayList<>();
        for (long[] r : sorted) {
            if (!out.isEmpty() && r[0] <= out.get(out.size() - 1)[1] + 1) out.get(out.size() - 1)[1] = Math.max(out.get(out.size() - 1)[1], r[1]);
            else out.add(new long[] {r[0], r[1]});
        }
        return out;
    }

    static List<long[]> missing(long lo, long hi, List<long[]> have) {
        List<long[]> gaps = new ArrayList<>();
        long cur = lo;
        for (long[] r : merge(have)) {
            if (r[1] < cur || r[0] > hi) continue;
            if (r[0] > cur) gaps.add(new long[] {cur, r[0] - 1});
            cur = Math.max(cur, r[1] + 1);
        }
        if (cur <= hi) gaps.add(new long[] {cur, hi});
        return gaps;
    }

    /** A JSON-RPC node refused a call. */
    public static final class RpcException extends RuntimeException {
        private static final long serialVersionUID = 1L;

        RpcException(String method, long code, String message) {
            super("rpc " + method + ": " + code + " " + message);
        }
    }

    /** Finds reward events paying a set of addresses and saves them in a {@link MemoryStore}. */
    public static final class Indexer {
        private final MemoryStore store;
        private final String rpc;
        private final Transport transport;
        /** Blocks per eth_getLogs (halved automatically when a node refuses a range). */
        public long step = 2000;

        /** An indexer reading {@code rpc} (Base's public RPC if null) with {@code transport} (the default if null). */
        public Indexer(MemoryStore store, String rpc, Transport transport) {
            this.store = store;
            this.rpc = rpc == null ? DEFAULT_RPC : rpc;
            this.transport = transport == null ? Transport.urlConnection() : transport;
        }

        /** The store, to read events back. */
        public MemoryStore store() {
            return store;
        }

        /**
         * Index rewards paid to {@code addresses} from {@code fromBlock} (or {@code days} back) to {@code toBlock}
         * (or the head); returns how many new matching events were stored. {@code progress} gets {done, total, found}.
         */
        public int scan(List<String> addresses, Long fromBlock, Double days, Long toBlock, Consumer<long[]> progress) {
            List<String> addrs = new ArrayList<>();
            for (String a : addresses) {
                String l = a.toLowerCase(Locale.ROOT);
                if (l.length() != 42 || !l.startsWith("0x")) throw new IllegalArgumentException(a + " is not an address");
                if (!addrs.contains(l)) addrs.add(l);
            }
            if (addrs.isEmpty()) throw new IllegalArgumentException("no addresses to scan");
            long head = toBlock != null ? toBlock : head();
            long start = fromBlock != null ? fromBlock : days != null ? Math.max(0, (System.currentTimeMillis() / 1000 - (long) (days * 86400) - BASE_GENESIS_TIMESTAMP) / 2) : 0;
            long lo = Math.max(start, V4_FIRST_BLOCK);
            List<long[]> gaps = new ArrayList<>();
            if (lo <= head) for (String a : addrs) gaps.addAll(missing(lo, head, store.scanned(a)));
            List<long[]> plan = merge(gaps);
            long total = 0, done = 0;
            for (long[] r : plan) total += r[1] - r[0] + 1;
            Set<String> watch = new HashSet<>(addrs);
            int found = 0;
            for (long[] r : plan) {
                long s = step;
                for (long from = r[0]; from <= r[1]; ) {
                    long to = Math.min(from + s - 1, r[1]);
                    List<Event> events;
                    try {
                        events = fetch(from, to);
                    } catch (RpcException e) {
                        String m = e.getMessage().toLowerCase(Locale.ROOT);
                        if (!m.contains("rate") && (m.contains("range") || m.contains("too many") || m.contains("limit exceeded")) && s > 50) {
                            s /= 2; // this node caps log ranges or result sizes: retry the chunk smaller
                            continue;
                        }
                        throw e;
                    }
                    List<Event> mine = new ArrayList<>();
                    for (Event e : events) if (e.pays(watch)) mine.add(e);
                    store.save(mine, addrs, from, to);
                    found += mine.size();
                    done += to - from + 1;
                    if (progress != null) progress.accept(new long[] {done, total, found});
                    from = to + 1;
                }
            }
            return found;
        }

        /** The latest block number. */
        public long head() {
            return hex(call("eth_blockNumber", Collections.emptyList()).asText());
        }

        private List<Event> fetch(long lo, long hi) {
            Map<String, Object> filter = new LinkedHashMap<>();
            filter.put("fromBlock", "0x" + Long.toHexString(lo));
            filter.put("toBlock", "0x" + Long.toHexString(hi));
            // both V4 payout events in one call: topic0 is either
            filter.put("topics", Collections.singletonList(Arrays.asList(TOPIC_MARKET_REWARDS_V4, TOPIC_CREATOR_COIN_REWARDS)));
            JsonNode result = call("eth_getLogs", Collections.singletonList(filter));
            Map<String, Event> out = new LinkedHashMap<>();
            for (JsonNode n : result) decode(Json.MAPPER.convertValue(n, Log.class)).ifPresent(e -> out.putIfAbsent(e.key(), e));
            return new ArrayList<>(out.values());
        }

        private JsonNode call(String method, List<?> params) {
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("jsonrpc", "2.0");
            body.put("id", 1);
            body.put("method", method);
            body.put("params", params);
            byte[] payload = Json.write(body).getBytes(StandardCharsets.UTF_8);
            Map<String, String> headers = Collections.singletonMap("Content-Type", "application/json");
            RuntimeException last = null;
            for (int attempt = 0; attempt <= 5; attempt++) {
                if (attempt > 0) {
                    try {
                        Thread.sleep(Math.min(1L << attempt, 20) * 1000);
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                        throw new IllegalStateException(e);
                    }
                }
                Transport.Response r;
                try {
                    r = transport.send("POST", rpc, headers, payload, Duration.ofSeconds(60));
                } catch (IOException e) {
                    last = new RpcException(method, 0, e.getMessage());
                    continue;
                }
                if (r.status == 429 || r.status >= 500) {
                    last = new RpcException(method, r.status, "HTTP " + r.status);
                    continue;
                }
                JsonNode n = Json.read(r.body, JsonNode.class);
                JsonNode err = n.get("error");
                if (err != null && !err.isNull()) {
                    String msg = err.path("message").asText();
                    RpcException e = new RpcException(method, err.path("code").asLong(), msg);
                    if (msg.toLowerCase(Locale.ROOT).contains("rate") || msg.toLowerCase(Locale.ROOT).contains("timeout")) {
                        last = e;
                        continue;
                    }
                    throw e;
                }
                return n.get("result");
            }
            throw last;
        }
    }

    /** What one role earned in one token. */
    public static final class Line {
        /** Who earned it. */
        public final Role role;
        /** Token address. */
        public final String token;
        /** Ticker. */
        public final String symbol;
        /** Total in the token's smallest unit. */
        public final BigInteger raw;
        /** Total in whole tokens. */
        public final double amount;
        /** Value at current prices, or null if the token has no price. */
        public final Double usd;
        /** Payouts summed. */
        public final int payouts;

        Line(Role role, String token, String symbol, BigInteger raw, double amount, Double usd, int payouts) {
            this.role = role;
            this.token = token;
            this.symbol = symbol;
            this.raw = raw;
            this.amount = amount;
            this.usd = usd;
            this.payouts = payouts;
        }
    }

    /** What a set of addresses earned. USD uses current prices from the Zora API, not prices at payout time. */
    public static final class Report {
        /** The addresses. */
        public final List<String> addresses;
        /** Events summed. */
        public final int events;
        /** Totals per role and token. */
        public final List<Line> lines;

        Report(List<String> addresses, int events, List<Line> lines) {
            this.addresses = addresses;
            this.events = events;
            this.lines = lines;
        }

        /** Sum of every priced line, in USD. */
        public double totalUsd() {
            double s = 0;
            for (Line l : lines) if (l.usd != null) s += l.usd;
            return s;
        }

        /** $1,234.56, or $0.0042 below a cent. */
        public static String formatUsd(double x) {
            if (Math.abs(x) >= 0.01 || x == 0) return "$" + String.format(Locale.ROOT, "%,.2f", x);
            return "$" + new java.math.BigDecimal(x).round(new java.math.MathContext(4)).stripTrailingZeros().toPlainString();
        }

        /** A plain-text table. */
        public String toText() {
            StringBuilder sb = new StringBuilder("Zora rewards for ").append(String.join(", ", addresses)).append('\n');
            sb.append(events).append(" reward events\n");
            for (Line l : lines) {
                String amount = Math.abs(l.amount) >= 1 ? String.format(Locale.ROOT, "%,.4f", l.amount) : String.format(Locale.ROOT, "%.6g", l.amount);
                sb.append(String.format(Locale.ROOT, "  %-18s %16s %-12s %12s  (%d payouts)%n", l.role.label(), amount, l.symbol,
                        l.usd == null ? "—" : formatUsd(l.usd), l.payouts));
            }
            sb.append(String.format(Locale.ROOT, "  %-18s %16s %-12s %12s%n", "Total (current prices)", "", "", formatUsd(totalUsd())));
            return sb.toString();
        }

        /** Sum what {@code addresses} earned in {@code events}, priced with {@code client} (null skips pricing). */
        public static Report build(List<Event> events, List<String> addresses, ZoraCoins client) {
            Set<String> watch = new HashSet<>();
            for (String a : addresses) watch.add(a.toLowerCase(Locale.ROOT));
            Map<String, BigInteger> sums = new TreeMap<>();
            Map<String, Integer> counts = new HashMap<>();
            for (Event e : events) {
                for (Map.Entry<Role, Payout> kv : e.payouts.entrySet()) {
                    if (!watch.contains(kv.getValue().recipient)) continue;
                    String[] tokens = {e.currency, e.coin.isEmpty() ? ZERO_ADDRESS : e.coin};
                    BigInteger[] amounts = {kv.getValue().currency, kv.getValue().coin};
                    for (int i = 0; i < 2; i++) {
                        if (amounts[i].signum() <= 0) continue;
                        String k = kv.getKey().ordinal() + "|" + kv.getKey().name() + "|" + tokens[i];
                        sums.merge(k, amounts[i], BigInteger::add);
                        counts.merge(k, 1, Integer::sum);
                    }
                }
            }
            Map<String, Object[]> meta = new HashMap<>();
            List<Line> lines = new ArrayList<>();
            for (Map.Entry<String, BigInteger> kv : sums.entrySet()) {
                String[] parts = kv.getKey().split("\\|");
                String token = parts[2];
                Object[] m = meta.computeIfAbsent(token, t -> tokenMeta(client, t));
                double amount = new java.math.BigDecimal(kv.getValue()).movePointLeft((Integer) m[1]).doubleValue();
                Double usd = m[2] == null ? null : amount * (Double) m[2];
                lines.add(new Line(Role.valueOf(parts[1]), token, (String) m[0], kv.getValue(), amount, usd, counts.get(kv.getKey())));
            }
            List<String> sorted = new ArrayList<>(watch);
            Collections.sort(sorted);
            return new Report(sorted, events.size(), lines);
        }

        private static Object[] tokenMeta(ZoraCoins client, String address) {
            boolean isEth = ZERO_ADDRESS.equals(address);
            Object[] fallback = isEth ? new Object[] {"ETH", 18, null}
                    : ZoraCoins.USDC_ADDRESS.equals(address) ? new Object[] {"USDC", 6, 1.0} : new Object[] {address.substring(0, 8) + "…", 18, null};
            if (client == null) return fallback;
            try {
                Optional<Erc20Token> info = client.getTokenInfo(isEth ? ZoraCoins.WETH_ADDRESS : address, null);
                Currency cur = info.map(Erc20Token::getCurrency).orElse(null);
                if (cur == null) return fallback;
                Double price = null;
                try {
                    if (cur.getPriceUsd() != null) price = Double.parseDouble(cur.getPriceUsd());
                } catch (NumberFormatException ignored) {
                    // no price
                }
                return new Object[] {isEth ? "ETH" : (cur.getSymbol() != null ? cur.getSymbol() : fallback[0]),
                    cur.getDecimals() != null ? cur.getDecimals().intValue() : 18, price};
            } catch (ZoraApiException e) {
                return fallback;
            }
        }
    }
}
