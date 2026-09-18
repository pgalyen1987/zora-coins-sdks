package gateway

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/pgalyen1987/zora-coins-sdks/go/zora"
)

func fixture(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "fixtures", name+".json"))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// setup runs the gateway in front of a fake Zora API that answers from recorded fixtures.
func setup(t *testing.T, cfg Config) (*httptest.Server, *[]*http.Request) {
	t.Helper()
	var seen []*http.Request
	routes := map[string]string{"/coin": "coin", "/explore": "explore_page1", "/profile": "profile", "/search": "search",
		"/tokenInfo": "token_info", "/quote": "quote", "/coins": "coins", "/coinHolders": "coin_holders"}
	zoraAPI := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r.Clone(r.Context()))
		if r.URL.Path == "/coin" && r.URL.Query().Get("address") == "0xdead" {
			w.Write(fixture(t, "coin_missing"))
			return
		}
		if r.URL.Path == "/profile" && r.URL.Query().Get("identifier") == "ratelimited" {
			w.Header().Set("Retry-After", "0")
			w.WriteHeader(http.StatusTooManyRequests)
			w.Write([]byte(`{"error":"slow down"}`))
			return
		}
		name, ok := routes[r.URL.Path]
		if !ok {
			http.NotFound(w, r)
			return
		}
		w.Write(fixture(t, name))
	}))
	t.Cleanup(zoraAPI.Close)
	cfg.ZoraBaseURL = zoraAPI.URL
	srv, err := New(cfg, SDL)
	if err != nil {
		t.Fatal(err)
	}
	gw := httptest.NewServer(srv)
	t.Cleanup(gw.Close)
	return gw, &seen
}

type gqlResponse struct {
	Data   map[string]json.RawMessage `json:"data"`
	Errors []struct {
		Message string `json:"message"`
	} `json:"errors"`
}

func query(t *testing.T, gw *httptest.Server, q string, vars map[string]any, headers map[string]string) (gqlResponse, int) {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"query": q, "variables": vars})
	req, _ := http.NewRequest("POST", gw.URL+"/graphql", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out gqlResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	return out, resp.StatusCode
}

func TestCoinQueryDecodesIntoSDKTypes(t *testing.T) {
	gw, seen := setup(t, Config{})
	res, _ := query(t, gw, `query($a: String!) { coin(address: $a) { zoraType name symbol marketCap uniqueHolders coinType creatorProfile { handle } } }`,
		map[string]any{"a": "0xabc"}, map[string]string{"api-key": "caller-key"})
	if len(res.Errors) > 0 {
		t.Fatal(res.Errors)
	}
	var coin zora.Zora20Token // a GraphQL result decodes into the same type as REST
	if err := json.Unmarshal(res.Data["coin"], &coin); err != nil {
		t.Fatal(err)
	}
	if coin.GetName() == "" || coin.GetMarketCap() == "" || coin.GetCreatorProfile().GetHandle() == "" || coin.GetCoinType() == "" {
		t.Fatalf("coin = %s", res.Data["coin"])
	}
	if !strings.Contains(string(res.Data["coin"]), `"zoraType":"GraphQL`) {
		t.Errorf("zoraType missing: %s", res.Data["coin"])
	}
	if got := (*seen)[0].Header.Get("api-key"); got != "caller-key" {
		t.Errorf("forwarded api-key = %q, want the caller's", got)
	}
	if got := (*seen)[0].URL.Query().Get("chain"); got != "8453" {
		t.Errorf("chain = %q, want Base by default", got)
	}
}

func TestMissingCoinIsNull(t *testing.T) {
	gw, _ := setup(t, Config{})
	res, _ := query(t, gw, `{ coin(address: "0xdead") { name } }`, nil, nil)
	if len(res.Errors) > 0 || string(res.Data["coin"]) != "null" {
		t.Fatalf("got %s %v, want null and no error", res.Data["coin"], res.Errors)
	}
}

func TestExploreConnectionWithEnumArg(t *testing.T) {
	gw, seen := setup(t, Config{})
	res, _ := query(t, gw, `{ explore(listType: TOP_VOLUME_24H, pageSize: 2) { edges { node { symbol address } } pageInfo { hasNextPage endCursor } } }`, nil, nil)
	if len(res.Errors) > 0 {
		t.Fatal(res.Errors)
	}
	var page zora.Zora20TokenConnection
	json.Unmarshal(res.Data["explore"], &page)
	if len(page.Nodes()) != 2 || page.NextCursor() == "" {
		t.Fatalf("page = %s", res.Data["explore"])
	}
	q := (*seen)[0].URL.Query()
	if q.Get("listType") != "TOP_VOLUME_24H" || q.Get("count") != "2" {
		t.Errorf("upstream query = %v", q)
	}
}

func TestQuoteWithInputObject(t *testing.T) {
	gw, _ := setup(t, Config{})
	res, _ := query(t, gw, `query($in: QuoteRequest!) { quote(input: $in) { success call { target data value } quote { amountOut } } }`,
		map[string]any{"in": map[string]any{"tokenIn": map[string]any{"type": "eth"}, "tokenOut": map[string]any{"type": "erc20", "address": "0xc0"},
			"amountIn": "1000", "sender": "0xme", "recipient": "0xme", "slippage": 0.05, "chainId": 8453}}, nil)
	if len(res.Errors) > 0 {
		t.Fatal(res.Errors)
	}
	var q zora.QuoteResponse
	json.Unmarshal(res.Data["quote"], &q)
	if !q.GetSuccess() || q.GetCall().GetData() == "" {
		t.Fatalf("quote = %s", res.Data["quote"])
	}
}

func TestSeveralRootFieldsInOneRequest(t *testing.T) {
	gw, seen := setup(t, Config{})
	res, _ := query(t, gw, `{ profile(identifier: "jacob") { handle } search(text: "zora", pageSize: 5) { edges { node { zoraType } } } tokenInfo(address: "0x1") { currency { symbol priceUsd } } }`, nil, nil)
	if len(res.Errors) > 0 || len(res.Data) != 3 || len(*seen) != 3 {
		t.Fatalf("errors %v, %d fields, %d upstream calls", res.Errors, len(res.Data), len(*seen))
	}
}

func TestRootFieldLimit(t *testing.T) {
	gw, seen := setup(t, Config{MaxRootFields: 2})
	res, status := query(t, gw, `{ a: profile(identifier: "x") { handle } b: profile(identifier: "y") { handle } c: profile(identifier: "z") { handle } }`, nil, nil)
	if status != 400 || len(res.Errors) == 0 || len(*seen) != 0 {
		t.Fatalf("status %d, errors %v, %d upstream calls; want a 400 before any call", status, res.Errors, len(*seen))
	}
}

func TestRateLimitErrorIsExplained(t *testing.T) {
	gw, _ := setup(t, Config{})
	res, _ := query(t, gw, `{ profile(identifier: "ratelimited") { handle } }`, nil, nil)
	if len(res.Errors) == 0 || !strings.Contains(res.Errors[0].Message, "429") || !strings.Contains(res.Errors[0].Message, "api-key") {
		t.Fatalf("errors = %v", res.Errors)
	}
}

func TestServerKeyOnlyWhenCallerHasNone(t *testing.T) {
	gw, seen := setup(t, Config{ServerAPIKey: "server-key"})
	query(t, gw, `{ profile(identifier: "jacob") { handle } }`, nil, nil)
	query(t, gw, `{ profile(identifier: "jacob") { handle } }`, nil, map[string]string{"Authorization": "Bearer mine"})
	if (*seen)[0].Header.Get("api-key") != "server-key" || (*seen)[1].Header.Get("api-key") != "mine" {
		t.Fatalf("keys = %q, %q", (*seen)[0].Header.Get("api-key"), (*seen)[1].Header.Get("api-key"))
	}
}

func TestSchemaPlaygroundAndHealth(t *testing.T) {
	gw, _ := setup(t, Config{})
	for path, want := range map[string]string{"/schema.graphql": "type Zora20Token", "/": "GraphiQL", "/health": "ok"} {
		resp, err := http.Get(gw.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		var b bytes.Buffer
		b.ReadFrom(resp.Body)
		resp.Body.Close()
		if !strings.Contains(b.String(), want) {
			t.Errorf("%s does not contain %q", path, want)
		}
	}
}

func TestIntrospectionMatchesSDL(t *testing.T) {
	gw, _ := setup(t, Config{})
	res, _ := query(t, gw, `{ __schema { queryType { fields { name } } types { name } } }`, nil, nil)
	if len(res.Errors) > 0 {
		t.Fatal(res.Errors)
	}
	body := string(res.Data["__schema"])
	for _, want := range []string{`"coin"`, `"coinHolders"`, `"rewards"`, `"quote"`, `"Zora20Token"`, `"ListType"`, `"RewardsReport"`} {
		if !strings.Contains(body, want) {
			t.Errorf("introspection lacks %s", want)
		}
	}
}
