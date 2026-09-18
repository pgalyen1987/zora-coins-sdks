//go:build live

// Live checks against Zora's production API: every endpoint through the SDK, plus a strict decode
// that fails on any field the API returns but the spec (and so this SDK) doesn't know about.
//
//	go test -tags live -run Live -v ./zora
package zora

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"testing"
	"time"
)

const fatVance = "0x0b8590d3c0b1ee6c797e184a4afbb15f8f58a46b"

func liveClient() *Client { return NewClient() }

func pace() { time.Sleep(350 * time.Millisecond) } // stay polite without an API key

func TestLiveEveryEndpoint(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	c := liveClient()
	check := func(name string, err error, ok bool, detail string) {
		t.Helper()
		pace()
		if err != nil {
			t.Errorf("%-28s error: %v", name, err)
			return
		}
		if !ok {
			t.Errorf("%-28s returned nothing useful (%s)", name, detail)
			return
		}
		t.Logf("ok  %-28s %s", name, detail)
	}

	coin, err := c.Coin(ctx, fatVance, nil)
	check("Coin", err, coin.GetName() != "", coin.GetName()+" / "+coin.GetSymbol())

	coins, err := c.CoinsByAddress(ctx, fatVance)
	check("Coins", err, len(coins) == 1, fmt.Sprint(len(coins), " coin"))

	holders, err := c.CoinHolders(ctx, fatVance, &CoinHoldersParams{PageSize: 3})
	check("CoinHolders", err, len(holders.Nodes()) > 0, fmt.Sprint(len(holders.Nodes()), " holders, next=", holders.NextCursor() != ""))

	swaps, err := c.CoinSwaps(ctx, fatVance, &CoinSwapsParams{PageSize: 3})
	check("CoinSwaps", err, swaps != nil, fmt.Sprint(len(swaps.Nodes()), " swaps"))

	comments, err := c.CoinComments(ctx, fatVance, &CoinCommentsParams{PageSize: 3})
	check("CoinComments", err, comments != nil, fmt.Sprint(len(comments.Nodes()), " comments"))

	merged, err := c.CoinMergedComments(ctx, fatVance, &CoinMergedCommentsParams{PageSize: 3})
	check("CoinMergedComments", err, merged != nil, fmt.Sprint(len(merged.Nodes()), " comments"))

	hist, err := c.CoinPriceHistory(ctx, fatVance, nil)
	check("CoinPriceHistory", err, hist != nil, fmt.Sprint(len(hist.GetOneDay()), " points in the last day"))

	list, err := c.CoinsList(ctx, &CoinsListParams{PageSize: 3})
	check("CoinsList", err, len(list.Nodes()) > 0, fmt.Sprint(len(list.Nodes()), " coins"))

	info, err := c.TokenInfo(ctx, USDCAddress, nil)
	check("TokenInfo", err, info != nil, "USDC")

	for _, lt := range []ListType{ListTypeTopGainers, ListTypeNew, ListTypeMostValuableCreators} {
		page, err := c.Explore(ctx, lt, &ExploreParams{PageSize: 3})
		check("Explore "+string(lt), err, len(page.Nodes()) > 0, fmt.Sprint(len(page.Nodes()), " coins"))
	}

	n := 0
	for coin, err := range c.IterExplore(ctx, ListTypeTopVolume24h, &ExploreParams{PageSize: 2}) {
		if err != nil {
			t.Errorf("IterExplore: %v", err)
			break
		}
		if coin.GetAddress() == "" {
			t.Errorf("IterExplore yielded a coin without an address")
		}
		if n++; n == 5 {
			break // crosses into a third page, then stops early
		}
	}
	check("IterExplore (3 pages)", nil, n == 5, fmt.Sprint(n, " coins across pages"))

	search, err := c.Search(ctx, "zora", &SearchParams{PageSize: 3})
	check("Search", err, len(search.Nodes()) > 0, fmt.Sprint(len(search.Nodes()), " results"))

	trend, err := c.TrendsByName(ctx, "base", &TrendsByNameParams{PageSize: 3})
	check("TrendsByName", err, trend != nil, fmt.Sprint(len(trend.Nodes()), " trends"))

	if nodes := trend.Nodes(); len(nodes) > 0 && nodes[0].GetSymbol() != "" {
		tc, err := c.TrendCoin(ctx, nodes[0].GetSymbol(), nil)
		if errors.Is(err, ErrNotFound) {
			err = nil // a trend listed by name need not resolve by ticker
		}
		check("TrendCoin", err, true, nodes[0].GetSymbol()+" -> "+tc.GetName())
	}

	lb, err := c.TraderLeaderboard(ctx, &TraderLeaderboardParams{PageSize: 3})
	check("TraderLeaderboard", err, lb != nil, fmt.Sprint(len(lb.Nodes()), " traders"))

	fc, err := c.FeaturedCreators(ctx, &FeaturedCreatorsParams{PageSize: 3})
	check("FeaturedCreators", err, fc != nil, fmt.Sprint(len(fc.Nodes()), " creators"))

	ls, err := c.LatestLiveStreams(ctx, &LatestLiveStreamsParams{PageSize: 3})
	check("LatestLiveStreams", err, ls != nil, fmt.Sprint(len(ls.Nodes()), " streams"))

	ts, err := c.TopLiveStreams(ctx, &TopLiveStreamsParams{PageSize: 3})
	check("TopLiveStreams", err, ts != nil, fmt.Sprint(len(ts.Nodes()), " streams"))

	lc, err := c.CreatorLivestreamComments(ctx, fatVance, &CreatorLivestreamCommentsParams{PageSize: 3})
	check("CreatorLivestreamComments", err, true, fmt.Sprint(len(lc.Nodes()), " comments"))

	p, err := c.Profile(ctx, "rebelstudios")
	check("Profile", err, p.GetHandle() != "", p.GetHandle())

	pc, err := c.ProfileCoins(ctx, "rebelstudios", &ProfileCoinsParams{PageSize: 3})
	check("ProfileCoins", err, pc != nil, fmt.Sprint(len(pc.Nodes()), " created"))

	pb, err := c.ProfileBalances(ctx, "rebelstudios", &ProfileBalancesParams{PageSize: 3})
	check("ProfileBalances", err, pb != nil, fmt.Sprint(len(pb.Nodes()), " balances"))

	ps, err := c.ProfileSocial(ctx, "rebelstudios")
	check("ProfileSocial", err, ps != nil, ps.GetHandle())

	wa, err := c.WalletTradeActivity(ctx, "rebelstudios", &WalletTradeActivityParams{PageSize: 3})
	check("WalletTradeActivity", err, wa != nil, fmt.Sprint(len(wa.Nodes()), " trades"))

	cc, err := c.CreatorCoinPoolConfig(ctx, nil)
	check("CreatorCoinPoolConfig", err, cc != nil, "ok")

	ct, err := c.ContentCoinPoolConfig(ctx, CurrencyTypeZora, nil)
	check("ContentCoinPoolConfig", err, ct != nil, "ok")

	q, err := c.QuoteTrade(ctx, ETH(), ERC20(fatVance), "1000000000000", "0x8E57BFDE053dBb6862991759c19affC5F383d5D0", nil)
	check("Quote", err, q.GetCall().GetData() != "", "calldata "+fmt.Sprint(len(q.GetCall().GetData()))+" chars")

	_, err = c.Coin(ctx, "0x000000000000000000000000000000000000dead", nil)
	check("Coin (missing)", nil, errors.Is(err, ErrNotFound), fmt.Sprint("err = ", err))
}

// TestLiveStrictDecode fetches raw JSON and decodes it with unknown fields disallowed. A failure
// here means Zora started returning something the spec doesn't describe: regenerate from the new
// spec (make generate) and ship a release.
func TestLiveStrictDecode(t *testing.T) {
	cases := []struct {
		path string
		q    url.Values
		into any
	}{
		{"/coin", url.Values{"address": {fatVance}, "chain": {"8453"}}, &CoinResponse{}},
		{"/coinHolders", url.Values{"address": {fatVance}, "chainId": {"8453"}, "count": {"5"}}, &CoinHoldersResponse{}},
		{"/coinSwaps", url.Values{"address": {fatVance}, "chain": {"8453"}, "first": {"5"}}, &CoinSwapsResponse{}},
		{"/coinComments", url.Values{"address": {fatVance}, "chain": {"8453"}, "count": {"5"}}, &CoinCommentsResponse{}},
		{"/coinMergedComments", url.Values{"address": {fatVance}, "chain": {"8453"}, "count": {"5"}}, &CoinMergedCommentsResponse{}},
		{"/coinPriceHistory", url.Values{"address": {fatVance}, "chain": {"8453"}}, &CoinPriceHistoryResponse{}},
		{"/coinsList", url.Values{"first": {"5"}}, &CoinsListResponse{}},
		{"/explore", url.Values{"listType": {"TOP_GAINERS"}, "count": {"5"}}, &ExploreResponse{}},
		{"/explore", url.Values{"listType": {"MOST_VALUABLE_CREATORS"}, "count": {"5"}}, &ExploreResponse{}},
		{"/profile", url.Values{"identifier": {"rebelstudios"}}, &ProfileResponse{}},
		{"/profileCoins", url.Values{"identifier": {"rebelstudios"}, "count": {"5"}}, &ProfileCoinsResponse{}},
		{"/profileBalances", url.Values{"identifier": {"rebelstudios"}, "count": {"5"}}, &ProfileBalancesResponse{}},
		{"/profileSocial", url.Values{"identifier": {"rebelstudios"}}, &ProfileSocialResponse{}},
		{"/search", url.Values{"text": {"zora"}, "first": {"5"}}, &SearchResponse{}},
		{"/tokenInfo", url.Values{"address": {fatVance}, "chainId": {"8453"}}, &TokenInfoResponse{}},
		{"/traderLeaderboard", url.Values{"first": {"5"}}, &TraderLeaderboardResponse{}},
		{"/featuredCreators", url.Values{"first": {"5"}}, &FeaturedCreatorsResponse{}},
		{"/walletTradeActivity", url.Values{"identifier": {"rebelstudios"}, "first": {"5"}}, &WalletTradeActivityResponse{}},
		{"/creatorCoinPoolConfig", url.Values{}, &CreatorCoinPoolConfigResponse{}},
		{"/contentCoinPoolConfig", url.Values{"currencyType": {"ZORA"}}, &ContentCoinPoolConfigResponse{}},
		{"/latestLiveStreams", url.Values{"first": {"3"}}, &LatestLiveStreamsResponse{}},
		{"/topLiveStreams", url.Values{"first": {"3"}}, &TopLiveStreamsResponse{}},
		{"/trendsByName", url.Values{"name": {"base"}, "first": {"3"}}, &TrendsByNameResponse{}},
	}
	for _, tc := range cases {
		pace()
		resp, err := http.Get(DefaultBaseURL + tc.path + "?" + tc.q.Encode())
		if err != nil {
			t.Errorf("%s: %v", tc.path, err)
			continue
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode != 200 {
			t.Errorf("%s: HTTP %d %s", tc.path, resp.StatusCode, bytes.TrimSpace(body[:min(len(body), 200)]))
			continue
		}
		dec := json.NewDecoder(bytes.NewReader(body))
		dec.DisallowUnknownFields()
		if err := dec.Decode(tc.into); err != nil {
			t.Errorf("%s: %v", tc.path, err)
			continue
		}
		t.Logf("ok  %s decodes strictly (%d bytes)", tc.path, len(body))
	}
}
