package rewards

import (
	"context"
	"fmt"
	"html"
	"math"
	"math/big"
	"sort"
	"strconv"
	"strings"

	"github.com/pgalyen1987/zora-coins-sdks/go/zora"
)

// Token is what a report knows about a token it summed: symbol, decimals, and today's USD price.
type Token struct {
	Address  string   `json:"address"`
	Symbol   string   `json:"symbol"`
	Decimals int      `json:"decimals"`
	PriceUSD *float64 `json:"priceUsd,omitempty"` // nil when the API has no price
}

// Line is the total one role earned in one token.
type Line struct {
	Role    Role     `json:"role"`
	Token   string   `json:"token"`
	Raw     *big.Int `json:"raw"`
	Payouts int      `json:"payouts"`
}

// Report totals what a set of addresses earned. USD values use current prices from the Zora API,
// not the price at the time of each payout.
type Report struct {
	Addresses  []string           `json:"addresses"`
	Events     int                `json:"events"`
	FirstBlock uint64             `json:"firstBlock"`
	LastBlock  uint64             `json:"lastBlock"`
	Lines      []*Line            `json:"lines"`
	Tokens     map[string]*Token  `json:"tokens"`
	ByCoinUSD  map[string]float64 `json:"byCoinUsd"`
	ByTimeUSD  map[string]float64 `json:"byTimeUsd"` // hour buckets for spans up to 3 days, else days (UTC)
	CoinNames  map[string]string  `json:"coinNames"`
}

// Amount is a line's total in whole tokens.
func (r *Report) Amount(l *Line) float64 {
	dec := 18
	if t := r.Tokens[l.Token]; t != nil {
		dec = t.Decimals
	}
	f, _ := new(big.Float).Quo(new(big.Float).SetInt(l.Raw), new(big.Float).SetFloat64(math.Pow10(dec))).Float64()
	return f
}

// USD is a line's value at current prices, and false if the token has no price.
func (r *Report) USD(l *Line) (float64, bool) {
	t := r.Tokens[l.Token]
	if t == nil || t.PriceUSD == nil {
		return 0, false
	}
	return r.Amount(l) * *t.PriceUSD, true
}

// TotalUSD sums every priced line.
func (r *Report) TotalUSD() float64 {
	var s float64
	for _, l := range r.Lines {
		if v, ok := r.USD(l); ok {
			s += v
		}
	}
	return s
}

// ByRoleUSD totals USD per role.
func (r *Report) ByRoleUSD() map[Role]float64 {
	out := map[Role]float64{}
	for _, l := range r.Lines {
		v, _ := r.USD(l)
		out[l.Role] += v
	}
	return out
}

// BuildReport sums what addresses earned in events, per role and token, and values it with current
// prices from client (which may be nil to skip pricing).
func BuildReport(ctx context.Context, events []*Event, addresses []string, client *zora.Client) (*Report, error) {
	watch := lowerSet(addresses)
	r := &Report{Events: len(events), Tokens: map[string]*Token{}, ByCoinUSD: map[string]float64{}, ByTimeUSD: map[string]float64{}, CoinNames: map[string]string{}}
	for a := range watch {
		r.Addresses = append(r.Addresses, a)
	}
	sort.Strings(r.Addresses)
	type credit struct {
		e     *Event
		token string
		raw   *big.Int
	}
	lines := map[string]*Line{}
	var credits []credit
	for _, e := range events {
		if r.FirstBlock == 0 || e.Block < r.FirstBlock {
			r.FirstBlock = e.Block
		}
		r.LastBlock = max(r.LastBlock, e.Block)
		for _, role := range Roles {
			p, ok := e.Payouts[role]
			if !ok || !watch[p.Recipient] {
				continue
			}
			coin := e.Coin
			if coin == "" {
				coin = ZeroAddress
			}
			for _, part := range []struct {
				token string
				amt   *big.Int
			}{{e.Currency, p.Currency}, {coin, p.Coin}} {
				if part.amt == nil || part.amt.Sign() <= 0 {
					continue
				}
				k := string(role) + "|" + part.token
				l := lines[k]
				if l == nil {
					l = &Line{Role: role, Token: part.token, Raw: new(big.Int)}
					lines[k] = l
				}
				l.Raw.Add(l.Raw, part.amt)
				l.Payouts++
				credits = append(credits, credit{e, part.token, part.amt})
			}
		}
	}
	for _, l := range lines {
		r.Lines = append(r.Lines, l)
		if r.Tokens[l.Token] == nil {
			r.Tokens[l.Token] = tokenMeta(ctx, client, l.Token)
		}
	}
	roleIndex := map[Role]int{}
	for i, x := range Roles {
		roleIndex[x] = i
	}
	sort.Slice(r.Lines, func(i, j int) bool {
		if r.Lines[i].Role != r.Lines[j].Role {
			return roleIndex[r.Lines[i].Role] < roleIndex[r.Lines[j].Role]
		}
		return r.Lines[i].Token < r.Lines[j].Token
	})
	hourly := len(events) > 0 && events[len(events)-1].Time().Sub(events[0].Time()).Hours() <= 72
	for _, c := range credits {
		t := r.Tokens[c.token]
		if t == nil || t.PriceUSD == nil {
			continue
		}
		amt, _ := new(big.Float).Quo(new(big.Float).SetInt(c.raw), new(big.Float).SetFloat64(math.Pow10(t.Decimals))).Float64()
		usd := amt * *t.PriceUSD
		if c.e.Coin != "" {
			r.ByCoinUSD[c.e.Coin] += usd
		}
		layout := "2006-01-02"
		if hourly {
			layout = "2006-01-02 15:00"
		}
		r.ByTimeUSD[c.e.Time().Format(layout)] += usd
	}
	if client != nil {
		for _, coin := range topKeys(r.ByCoinUSD, 15) {
			c, err := client.Coin(ctx, coin, nil)
			if err == nil && c.GetSymbol() != "" {
				r.CoinNames[coin] = c.GetSymbol()
			} else {
				r.CoinNames[coin] = coin
			}
		}
	}
	return r, nil
}

func tokenMeta(ctx context.Context, client *zora.Client, address string) *Token {
	isETH := address == ZeroAddress
	fallback := &Token{Address: address, Symbol: short(address), Decimals: 18}
	switch {
	case isETH:
		fallback.Symbol = "ETH"
	case address == zora.USDCAddress:
		fallback.Symbol, fallback.Decimals, fallback.PriceUSD = "USDC", 6, zora.Ptr(1.0)
	}
	if client == nil {
		return fallback
	}
	lookup := address
	if isETH {
		lookup = zora.WETHAddress // ETH is priced as WETH
	}
	info, err := client.TokenInfo(ctx, lookup, nil)
	cur := info.GetCurrency()
	if err != nil || cur == nil {
		return fallback
	}
	t := &Token{Address: address, Symbol: cur.GetSymbol(), Decimals: 18}
	if isETH {
		t.Symbol = "ETH"
	}
	if cur.Decimals != nil {
		t.Decimals = *cur.Decimals
	}
	if p, err := strconv.ParseFloat(cur.GetPriceUSD(), 64); err == nil {
		t.PriceUSD = &p
	}
	if t.Symbol == "" {
		t.Symbol = fallback.Symbol
	}
	return t
}

func short(a string) string {
	if len(a) > 10 {
		return a[:6] + "…" + a[len(a)-4:]
	}
	return a
}

func topKeys(m map[string]float64, n int) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool { return m[keys[i]] > m[keys[j]] })
	if len(keys) > n {
		keys = keys[:n]
	}
	return keys
}

func fmtAmount(x float64) string {
	if math.Abs(x) >= 1 {
		return commas(strconv.FormatFloat(x, 'f', 4, 64))
	}
	return strconv.FormatFloat(x, 'g', 6, 64)
}

// FormatUSD formats dollars: $1,234.56, or $0.0042 below a cent.
func FormatUSD(x float64) string {
	if math.Abs(x) >= 0.01 || x == 0 {
		return "$" + commas(strconv.FormatFloat(x, 'f', 2, 64))
	}
	return "$" + strconv.FormatFloat(x, 'g', 4, 64)
}

func commas(s string) string {
	neg := strings.HasPrefix(s, "-")
	s = strings.TrimPrefix(s, "-")
	whole, frac, _ := strings.Cut(s, ".")
	for i := len(whole) - 3; i > 0; i -= 3 {
		whole = whole[:i] + "," + whole[i:]
	}
	if frac != "" {
		whole += "." + frac
	}
	if neg {
		return "-" + whole
	}
	return whole
}

// Text renders the report as a plain-text table.
func (r *Report) Text() string {
	var b strings.Builder
	fmt.Fprintf(&b, "Zora rewards for %s\n", strings.Join(r.Addresses, ", "))
	fmt.Fprintf(&b, "%d reward events", r.Events)
	if r.Events > 0 {
		fmt.Fprintf(&b, ", blocks %d–%d", r.FirstBlock, r.LastBlock)
	}
	b.WriteString("\n")
	for _, l := range r.Lines {
		usd := "—"
		if v, ok := r.USD(l); ok {
			usd = FormatUSD(v)
		}
		sym := l.Token
		if t := r.Tokens[l.Token]; t != nil {
			sym = t.Symbol
		}
		fmt.Fprintf(&b, "  %-18s %16s %-12s %12s  (%d payouts)\n", l.Role.Label(), fmtAmount(r.Amount(l)), sym, usd, l.Payouts)
	}
	fmt.Fprintf(&b, "  %-18s %16s %-12s %12s\n", "Total (current prices)", "", "", FormatUSD(r.TotalUSD()))
	return b.String()
}

// HTML renders a self-contained report page (no external assets; light and dark themes).
func (r *Report) HTML(title string) string {
	esc := html.EscapeString
	keys := make([]string, 0, len(r.ByTimeUSD))
	for k := range r.ByTimeUSD {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	if len(keys) > 60 {
		keys = keys[len(keys)-60:]
	}
	peak := 0.0
	for _, k := range keys {
		peak = max(peak, r.ByTimeUSD[k])
	}
	if peak == 0 {
		peak = 1
	}
	const barW, gap = 12, 3
	slots := max(len(keys), 24)
	var bars strings.Builder
	for i, k := range keys {
		v := r.ByTimeUSD[k]
		h := max(v/peak*110, 1)
		fmt.Fprintf(&bars, `<rect x="%d" y="%.1f" width="%d" height="%.1f" rx="2"><title>%s UTC: %s</title></rect>`, i*(barW+gap), 120-v/peak*110, barW, h, esc(k), FormatUSD(v))
	}
	unit := "day"
	if len(keys) > 0 && len(keys[0]) > 10 {
		unit = "hour"
	}
	var rows, coins, kpis strings.Builder
	for _, l := range r.Lines {
		usd := "—"
		if v, ok := r.USD(l); ok {
			usd = FormatUSD(v)
		}
		sym := l.Token
		if t := r.Tokens[l.Token]; t != nil {
			sym = t.Symbol
		}
		fmt.Fprintf(&rows, "<tr><td>%s</td><td class=n>%s</td><td>%s</td><td class=n>%s</td><td class=n>%d</td></tr>", esc(l.Role.Label()), fmtAmount(r.Amount(l)), esc(sym), usd, l.Payouts)
	}
	for _, c := range topKeys(r.ByCoinUSD, 15) {
		name := r.CoinNames[c]
		if name == "" {
			name = c
		}
		fmt.Fprintf(&coins, `<tr><td><a href="https://zora.co/coin/base:%s">%s</a></td><td class=n>%s</td></tr>`, esc(c), esc(name), FormatUSD(r.ByCoinUSD[c]))
	}
	byRole := r.ByRoleUSD()
	for _, role := range Roles {
		if v := byRole[role]; v > 0 {
			fmt.Fprintf(&kpis, "<div class=kpi><span>%s</span><b>%s</b></div>", esc(role.Label()), FormatUSD(v))
		}
	}
	return fmt.Sprintf(`<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>%s</title><style>
:root{--bg:#fafaf9;--fg:#1c1917;--muted:#78716c;--line:#e7e5e4;--accent:#4f46e5}
@media (prefers-color-scheme:dark){:root{--bg:#0c0a09;--fg:#f5f5f4;--muted:#a8a29e;--line:#292524;--accent:#818cf8}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}main{max-width:880px;margin:0 auto;padding:32px 16px}
h1{font-size:24px;margin:0 0 4px}.muted{color:var(--muted);font-size:13px;word-break:break-all}
.kpis{display:flex;flex-wrap:wrap;gap:12px;margin:20px 0}.kpi{border:1px solid var(--line);border-radius:10px;padding:12px 16px;min-width:150px}
.kpi span{display:block;color:var(--muted);font-size:12px}.kpi b{font-size:20px}
table{width:100%%;border-collapse:collapse;margin:8px 0 24px}td,th{padding:8px 6px;border-bottom:1px solid var(--line);text-align:left}.n{text-align:right;font-variant-numeric:tabular-nums}
svg rect{fill:var(--accent)}a{color:var(--accent)}h2{font-size:16px;margin:24px 0 4px}
</style></head><body><main>
<h1>%s</h1><div class=muted>%s</div>
<div class=kpis><div class=kpi><span>Total earned (current prices)</span><b>%s</b></div>%s<div class=kpi><span>Reward events</span><b>%d</b></div></div>
<h2>Earnings per %s (USD, UTC)</h2><svg viewBox="0 0 %d 122" width="100%%" height="140" role="img" aria-label="Earnings per %s">%s</svg>
<h2>By role and token</h2><table><tr><th>Role</th><th class=n>Amount</th><th>Token</th><th class=n>USD now</th><th class=n>Payouts</th></tr>%s</table>
<h2>Top coins</h2><table><tr><th>Coin</th><th class=n>USD now</th></tr>%s</table>
<p class=muted>USD values use current token prices from the Zora API, not prices at the time of each payout. Source: CoinMarketRewardsV4 / CoinTradeRewards events on Base. Generated by zora-coins-go.</p>
</main></body></html>`, esc(title), esc(title), esc(strings.Join(r.Addresses, ", ")), FormatUSD(r.TotalUSD()), kpis.String(), r.Events,
		unit, slots*(barW+gap), unit, bars.String(), rows.String(), coins.String())
}
