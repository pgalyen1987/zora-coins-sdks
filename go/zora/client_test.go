package zora

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// fixture reads a recorded API response from the repo's shared fixtures/ directory.
func fixture(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "fixtures", name+".json"))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// server answers each path with a handler and returns a client pointed at it.
func server(t *testing.T, routes map[string]http.HandlerFunc) *Client {
	t.Helper()
	mux := http.NewServeMux()
	for p, h := range routes {
		mux.HandleFunc(p, h)
	}
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return NewClient(WithBaseURL(srv.URL), WithAPIKey(""), WithMaxRetries(2))
}

func serve(body []byte) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) { w.Write(body) }
}

func TestCoinDecodesRealResponse(t *testing.T) {
	var gotQuery string
	c := server(t, map[string]http.HandlerFunc{"/coin": func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.RawQuery
		w.Write(fixture(t, "coin"))
	}})
	coin, err := c.Coin(context.Background(), "0xabc", nil)
	if err != nil {
		t.Fatal(err)
	}
	if coin.GetAddress() == "" || coin.GetSymbol() == "" || coin.GetMarketCap() == "" {
		t.Errorf("coin missing core fields: %+v", coin)
	}
	if coin.GetTypename() == "" {
		t.Errorf("__typename was not decoded")
	}
	if !strings.Contains(gotQuery, "chain=8453") || !strings.Contains(gotQuery, "address=0xabc") {
		t.Errorf("query = %q, want address and chain defaulting to Base", gotQuery)
	}
}

func TestMissingCoinIsErrNotFound(t *testing.T) {
	c := server(t, map[string]http.HandlerFunc{"/coin": serve(fixture(t, "coin_missing"))})
	coin, err := c.Coin(context.Background(), "0xdead", nil)
	if !errors.Is(err, ErrNotFound) || coin != nil {
		t.Fatalf("got (%v, %v), want ErrNotFound", coin, err)
	}
}

func TestIterExploreFollowsCursors(t *testing.T) {
	p1, p2 := fixture(t, "explore_page1"), fixture(t, "explore_page2")
	var page1 struct {
		ExploreList *Zora20TokenConnection `json:"exploreList"`
	}
	json.Unmarshal(p1, &page1)
	cursor := page1.ExploreList.NextCursor()
	var calls atomic.Int32
	c := server(t, map[string]http.HandlerFunc{"/explore": func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.Query().Get("listType") != "TOP_VOLUME_24H" {
			t.Errorf("listType = %q", r.URL.Query().Get("listType"))
		}
		switch r.URL.Query().Get("after") {
		case "":
			w.Write(p1)
		case cursor:
			// page 2 as recorded, but marked last so the iterator must stop on its own
			var d map[string]map[string]any
			json.Unmarshal(p2, &d)
			d["exploreList"]["pageInfo"] = map[string]any{"hasNextPage": false}
			json.NewEncoder(w).Encode(d)
		default:
			t.Errorf("unexpected cursor %q", r.URL.Query().Get("after"))
		}
	}})
	var got []string
	for coin, err := range c.IterExplore(context.Background(), ListTypeTopVolume24h, &ExploreParams{PageSize: 2}) {
		if err != nil {
			t.Fatal(err)
		}
		got = append(got, coin.GetAddress())
	}
	if len(got) != 4 || calls.Load() != 2 {
		t.Fatalf("got %d coins over %d requests, want 4 over 2", len(got), calls.Load())
	}
}

func TestIteratorStopsFetchingOnBreak(t *testing.T) {
	var calls atomic.Int32
	c := server(t, map[string]http.HandlerFunc{"/explore": func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Write(fixture(t, "explore_page1"))
	}})
	for range c.IterExplore(context.Background(), ListTypeNew, nil) {
		break
	}
	if calls.Load() != 1 {
		t.Fatalf("made %d requests after break, want 1", calls.Load())
	}
}

func TestIteratorStopsOnRepeatedCursor(t *testing.T) {
	var calls atomic.Int32
	c := server(t, map[string]http.HandlerFunc{"/explore": func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Write(fixture(t, "explore_page1")) // always the same cursor: must not loop forever
	}})
	n := 0
	for _, err := range c.IterExplore(context.Background(), ListTypeNew, nil) {
		if err != nil {
			t.Fatal(err)
		}
		n++
	}
	if calls.Load() != 2 {
		t.Fatalf("made %d requests, want 2 (the second repeats the cursor)", calls.Load())
	}
}

func TestRetriesRateLimitThenSucceeds(t *testing.T) {
	var calls atomic.Int32
	c := server(t, map[string]http.HandlerFunc{"/tokenInfo": func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) < 3 {
			w.Header().Set("Retry-After", "0")
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		w.Write(fixture(t, "token_info"))
	}})
	info, err := c.TokenInfo(context.Background(), USDCAddress, nil)
	if err != nil || info == nil || calls.Load() != 3 {
		t.Fatalf("got (%v, %v) after %d calls", info, err, calls.Load())
	}
}

func TestRateLimitErrorAfterRetries(t *testing.T) {
	c := server(t, map[string]http.HandlerFunc{"/profile": func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Retry-After", "0")
		w.WriteHeader(http.StatusTooManyRequests)
		w.Write([]byte(`{"error":"slow down"}`))
	}})
	_, err := c.Profile(context.Background(), "jacob")
	var apiErr *APIError
	if !errors.As(err, &apiErr) || !apiErr.RateLimited() || apiErr.Message != "slow down" {
		t.Fatalf("err = %v, want a rate-limit APIError carrying the message", err)
	}
}

func TestClientErrorIsNotRetried(t *testing.T) {
	var calls atomic.Int32
	c := server(t, map[string]http.HandlerFunc{"/search": func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"message":"text is required"}`))
	}})
	_, err := c.Search(context.Background(), "", nil)
	var apiErr *APIError
	if !errors.As(err, &apiErr) || apiErr.StatusCode != 400 || calls.Load() != 1 {
		t.Fatalf("err = %v after %d calls, want one 400", err, calls.Load())
	}
}

func TestContextCancelStopsRetrying(t *testing.T) {
	c := server(t, map[string]http.HandlerFunc{"/profile": func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Retry-After", "10")
		w.WriteHeader(http.StatusServiceUnavailable)
	}})
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	start := time.Now()
	_, err := c.Profile(ctx, "jacob")
	if !errors.Is(err, context.DeadlineExceeded) || time.Since(start) > 2*time.Second {
		t.Fatalf("err = %v after %v, want a prompt deadline error", err, time.Since(start))
	}
}

func TestHeadersAndQueryEncoding(t *testing.T) {
	c := server(t, map[string]http.HandlerFunc{"/profileBalances": func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if got := q["chainIds"]; len(got) != 2 || got[0] != "8453" || got[1] != "7777777" {
			t.Errorf("chainIds = %v, want repeated key", got)
		}
		if q.Get("excludeHidden") != "false" {
			t.Errorf("excludeHidden = %q, want an explicit false", q.Get("excludeHidden"))
		}
		if q.Get("sortOption") != "USD_VALUE" || q.Get("count") != "7" || q.Get("identifier") != "jacob" {
			t.Errorf("query = %v", q)
		}
		if r.Header.Get("api-key") != "k-123" || !strings.HasPrefix(r.Header.Get("User-Agent"), "my-app zora-coins-go/") {
			t.Errorf("headers = %v", r.Header)
		}
		w.Write(fixture(t, "profile_balances"))
	}})
	c.apiKey = "k-123"
	WithUserAgent("my-app")(c)
	page, err := c.ProfileBalances(context.Background(), "jacob", &ProfileBalancesParams{
		PageSize: 7, SortOption: SortOptionUSDValue, ExcludeHidden: Ptr(false), ChainIDs: []int{8453, 7777777},
	})
	if err != nil || len(page.Nodes()) == 0 {
		t.Fatalf("got %v, %v", page, err)
	}
}

func TestCoinsSendsOneJSONParamPerCoin(t *testing.T) {
	c := server(t, map[string]http.HandlerFunc{"/coins": func(w http.ResponseWriter, r *http.Request) {
		got := r.URL.Query()["coins"]
		if len(got) != 2 || got[0] != `{"chainId":8453,"collectionAddress":"0xaaa"}` {
			t.Errorf("coins = %v", got)
		}
		w.Write(fixture(t, "coins"))
	}})
	coins, err := c.CoinsByAddress(context.Background(), "0xAAA", "0xbbb")
	if err != nil || len(coins) != 2 {
		t.Fatalf("got %d coins, %v", len(coins), err)
	}
}

func TestQuoteTradeFillsDefaultsAndDecodesStringBool(t *testing.T) {
	c := server(t, map[string]http.HandlerFunc{"/quote": func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("%s %s", r.Method, r.Header.Get("Content-Type"))
		}
		body, _ := io.ReadAll(r.Body)
		var req map[string]any
		json.Unmarshal(body, &req)
		if req["recipient"] != "0xme" || req["slippage"] != 0.05 || req["chainId"] != float64(8453) || req["amountIn"] != "1000" {
			t.Errorf("request = %s", body)
		}
		if in := req["tokenIn"].(map[string]any); in["type"] != "eth" || in["address"] != nil {
			t.Errorf("tokenIn = %v", in)
		}
		w.Write(fixture(t, "quote"))
	}})
	q, err := c.QuoteTrade(context.Background(), ETH(), ERC20("0xcoin"), "1000", "0xme", nil)
	if err != nil {
		t.Fatal(err)
	}
	if !q.GetSuccess() || q.GetCall().GetData() == "" || q.GetCall().GetTarget() == "" {
		t.Fatalf("quote = %+v", q)
	}
}

func TestFlexBool(t *testing.T) {
	for in, want := range map[string]bool{`true`: true, `"true"`: true, `false`: false, `"false"`: false} {
		var b FlexBool
		if err := json.Unmarshal([]byte(in), &b); err != nil || bool(b) != want {
			t.Errorf("%s -> %v, %v", in, b, err)
		}
	}
	var b FlexBool
	if json.Unmarshal([]byte(`"maybe"`), &b) == nil {
		t.Error("accepted a non-boolean")
	}
}

func TestNilSafeGetters(t *testing.T) {
	var coin *Zora20Token
	if coin.GetCreatorProfile().GetAvatar().GetPreviewImage().GetSmall() != "" || coin.GetUniqueHolders() != 0 {
		t.Fatal("getter chain on nil should return zero values")
	}
	var page *TokenBalanceConnection
	if page.Nodes() != nil || page.NextCursor() != "" {
		t.Fatal("nil page should have no nodes and no cursor")
	}
}

func TestEveryFixtureDecodesStrictly(t *testing.T) {
	cases := map[string]any{
		"coin": &CoinResponse{}, "coin_holders": &CoinHoldersResponse{}, "coin_swaps": &CoinSwapsResponse{},
		"price_history": &CoinPriceHistoryResponse{}, "explore_page1": &ExploreResponse{}, "explore_page2": &ExploreResponse{},
		"profile": &ProfileResponse{}, "profile_balances": &ProfileBalancesResponse{}, "search": &SearchResponse{},
		"token_info": &TokenInfoResponse{}, "coins": &CoinsResponse{}, "quote": &QuoteResponse{},
	}
	for name, into := range cases {
		dec := json.NewDecoder(strings.NewReader(string(fixture(t, name))))
		dec.DisallowUnknownFields()
		if err := dec.Decode(into); err != nil {
			t.Errorf("%s: %v", name, err)
		}
	}
}
