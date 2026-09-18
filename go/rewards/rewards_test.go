package rewards

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
)

func realLogs(t *testing.T) []Log {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "fixtures", "rewards_v4_logs.json"))
	if err != nil {
		t.Fatal(err)
	}
	var logs []Log
	if err := json.Unmarshal(b, &logs); err != nil {
		t.Fatal(err)
	}
	return logs
}

func w(n uint64) string { return fmt.Sprintf("%064x", n) }

func TestDecodeRealV4Log(t *testing.T) {
	l := realLogs(t)[0]
	e, ok := DecodeLog(l)
	if !ok || e.Version != 4 || len(e.Coin) != 42 {
		t.Fatalf("decoded %+v, ok=%v", e, ok)
	}
	data, _ := hex.DecodeString(strings.TrimPrefix(l.Data, "0x"))
	if want := "0x" + hex.EncodeToString(data[3*32-20:3*32]); e.Payouts[RoleCreator].Recipient != want {
		t.Errorf("creator = %s, want %s", e.Payouts[RoleCreator].Recipient, want)
	}
	if want := new(big.Int).SetBytes(data[7*32 : 8*32]); e.Payouts[RoleCreator].Currency.Cmp(want) != 0 {
		t.Errorf("creator currency = %v, want %v", e.Payouts[RoleCreator].Currency, want)
	}
	block, _ := strconv.ParseUint(strings.TrimPrefix(l.BlockNumber, "0x"), 16, 64)
	if e.Block != block {
		t.Errorf("block = %d, want %d", e.Block, block)
	}
}

func TestDecodeV3(t *testing.T) {
	payout, plat, trade := "0x"+strings.Repeat("11", 20), "0x"+strings.Repeat("22", 20), "0x"+strings.Repeat("33", 20)
	proto, usdc := strings.Repeat("44", 20), strings.Repeat("55", 20)
	l := Log{
		Address: "0x" + strings.Repeat("ab", 20), BlockNumber: "0x1c9c380", TransactionHash: "0x" + strings.Repeat("cd", 32), LogIndex: "0x5",
		Topics: []string{TopicTradeRewardsV3, AddressTopic(payout), AddressTopic(plat), AddressTopic(trade)},
		Data:   "0x" + strings.Repeat("0", 24) + proto + w(100) + w(25) + w(4) + w(20) + strings.Repeat("0", 24) + usdc,
	}
	e, ok := DecodeLog(l)
	if !ok || e.Version != 3 || e.Coin != "0x"+strings.Repeat("ab", 20) || e.Currency != "0x"+usdc {
		t.Fatalf("decoded %+v", e)
	}
	checks := map[Role][2]any{RoleCreator: {payout, int64(100)}, RolePlatformReferrer: {plat, int64(25)}, RoleTradeReferrer: {trade, int64(4)}, RoleProtocol: {"0x" + proto, int64(20)}}
	for role, want := range checks {
		p := e.Payouts[role]
		if p.Recipient != want[0] || p.Currency.Int64() != want[1] || p.Coin.Sign() != 0 {
			t.Errorf("%s = %+v, want %v", role, p, want)
		}
	}
}

func TestDecodeIgnoresOtherEvents(t *testing.T) {
	if _, ok := DecodeLog(Log{Topics: []string{"0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"}, Data: "0x"}); ok {
		t.Fatal("decoded a Transfer as a reward")
	}
	if _, ok := DecodeLog(Log{}); ok {
		t.Fatal("decoded a log with no topics")
	}
}

func TestMissingRanges(t *testing.T) {
	got := missing(100, 200, [][2]uint64{{120, 130}, {125, 150}, {190, 250}})
	want := [][2]uint64{{100, 119}, {151, 189}}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("missing = %v, want %v", got, want)
	}
	if got := missing(100, 200, [][2]uint64{{50, 300}}); len(got) != 0 {
		t.Fatalf("fully covered range reported gaps %v", got)
	}
}

// fakeNode serves eth_blockNumber and eth_getLogs from real logs, optionally refusing wide ranges.
func fakeNode(t *testing.T, logs []Log, head uint64, maxRange uint64, calls *atomic.Int32) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var req struct {
			Method string           `json:"method"`
			Params []map[string]any `json:"params"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		switch req.Method {
		case "eth_blockNumber":
			fmt.Fprintf(w, `{"jsonrpc":"2.0","id":1,"result":"0x%x"}`, head)
		case "eth_getLogs":
			lo, _ := strconv.ParseUint(strings.TrimPrefix(req.Params[0]["fromBlock"].(string), "0x"), 16, 64)
			hi, _ := strconv.ParseUint(strings.TrimPrefix(req.Params[0]["toBlock"].(string), "0x"), 16, 64)
			if maxRange > 0 && hi-lo+1 > maxRange {
				fmt.Fprint(w, `{"jsonrpc":"2.0","id":1,"error":{"code":-32600,"message":"block range too large"}}`)
				return
			}
			var out []Log
			for _, l := range logs {
				b, _ := strconv.ParseUint(strings.TrimPrefix(l.BlockNumber, "0x"), 16, 64)
				if b >= lo && b <= hi {
					out = append(out, l)
				}
			}
			json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": 1, "result": out})
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestScanFindsResumesAndShrinksChunks(t *testing.T) {
	logs := realLogs(t)
	first, _ := DecodeLog(logs[0])
	watch := first.Payouts[RoleCreator].Recipient
	var calls atomic.Int32
	node := fakeNode(t, logs, first.Block+500, 700, &calls) // refuses ranges over 700 blocks
	idx := NewIndexer(NewMemoryStore(), node.URL)
	from := first.Block - 1000
	n, err := idx.Scan(context.Background(), []string{"0x" + strings.ToUpper(watch[2:])}, ScanOptions{FromBlock: from})
	if err != nil {
		t.Fatal(err)
	}
	if n == 0 {
		t.Fatal("found no events for the creator of a real reward log")
	}
	events, _ := idx.Store.EventsFor([]string{watch}, 0)
	if len(events) != n {
		t.Fatalf("stored %d, reported %d", len(events), n)
	}
	before := calls.Load()
	again, err := idx.Scan(context.Background(), []string{watch}, ScanOptions{FromBlock: from})
	if err != nil || again != 0 {
		t.Fatalf("second scan found %d (err %v), want 0", again, err)
	}
	if calls.Load()-before > 1 { // only eth_blockNumber: every range is already scanned
		t.Fatalf("second scan made %d RPC calls, want 1", calls.Load()-before)
	}
}

func TestFileStoreRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "r.json")
	st, err := OpenFileStore(path)
	if err != nil {
		t.Fatal(err)
	}
	e, _ := DecodeLog(realLogs(t)[0])
	who := e.Payouts[RoleCreator].Recipient
	if err := st.Save([]*Event{e}, []string{who}, 4, 10, 20); err != nil {
		t.Fatal(err)
	}
	again, err := OpenFileStore(path)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := again.EventsFor([]string{who}, 0)
	ranges, _ := again.Scanned(who, 4)
	if len(got) != 1 || got[0].Payouts[RoleCreator].Currency.Cmp(e.Payouts[RoleCreator].Currency) != 0 || fmt.Sprint(ranges) != "[[10 20]]" {
		t.Fatalf("round trip lost data: %v %v", got, ranges)
	}
}

func TestReportWithoutPricing(t *testing.T) {
	var events []*Event
	for _, l := range realLogs(t) {
		if e, ok := DecodeLog(l); ok {
			events = append(events, e)
		}
	}
	who := events[0].Payouts[RolePlatformReferrer].Recipient
	r, err := BuildReport(context.Background(), events, []string{who}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Lines) == 0 || r.Lines[0].Role != RolePlatformReferrer {
		t.Fatalf("lines = %+v", r.Lines)
	}
	if !strings.Contains(r.Text(), "Platform referral") || !strings.Contains(r.HTML("t"), "<svg") {
		t.Fatal("text or HTML rendering is missing its content")
	}
}

func TestFormatUSD(t *testing.T) {
	for in, want := range map[float64]string{0: "$0.00", 1234.5: "$1,234.50", 0.0042: "$0.0042", -2000: "$-2,000.00"} {
		if got := FormatUSD(in); got != want {
			t.Errorf("FormatUSD(%v) = %s, want %s", in, got, want)
		}
	}
}
