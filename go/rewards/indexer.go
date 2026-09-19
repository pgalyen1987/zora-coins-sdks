package rewards

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

// DefaultRPC is Base's public JSON-RPC endpoint. A private RPC is much faster for long histories.
const DefaultRPC = "https://mainnet.base.org"

// First blocks worth scanning. Probing Base found no CoinMarketRewardsV4 events before 2025-06-01
// (block 31,000,000) and hundreds per 2,000 blocks a week later.
const (
	V4FirstBlock = 31_000_000
	V3FirstBlock = 27_000_000
)

// V4Scan labels scanned ranges for the V4 hooks' events in a Store. Ranges saved as 4 were scanned for
// CoinMarketRewardsV4 alone, before CreatorCoinRewards was read too, so they don't count: a store
// written by an earlier version re-scans those blocks once (stored events are kept; repeats are ignored).
const V4Scan = 5

// Indexer finds reward events paying a set of addresses and saves them in a Store.
type Indexer struct {
	Store      Store
	RPCURL     string
	HTTP       *http.Client
	Step       uint64 // blocks per eth_getLogs for V4 (default 2,000; halved automatically if the node refuses)
	MaxRetries int    // per RPC call (default 5)
}

// NewIndexer returns an Indexer reading rpcURL (DefaultRPC if empty) into store.
func NewIndexer(store Store, rpcURL string) *Indexer {
	if rpcURL == "" {
		rpcURL = DefaultRPC
	}
	return &Indexer{Store: store, RPCURL: rpcURL, HTTP: &http.Client{Timeout: 60 * time.Second}, Step: 2000, MaxRetries: 5}
}

// ScanOptions picks the block range. Days counts back from now; FromBlock/ToBlock override it.
// With neither, the scan starts at V4FirstBlock (all of V4 history).
type ScanOptions struct {
	Days      float64
	FromBlock uint64
	ToBlock   uint64 // 0 = the chain head
	IncludeV3 bool   // also scan legacy V3 coins (CoinTradeRewards)
	// Progress, if set, is called after every chunk with blocks done, blocks total, events found.
	Progress func(done, total uint64, found int)
}

// Scan indexes rewards paid to addresses and returns how many new matching events it stored.
// Ranges already scanned for every address are skipped, so re-running is cheap.
func (x *Indexer) Scan(ctx context.Context, addresses []string, opt ScanOptions) (int, error) {
	addrs, err := normalise(addresses)
	if err != nil {
		return 0, err
	}
	head := opt.ToBlock
	if head == 0 {
		if head, err = x.Head(ctx); err != nil {
			return 0, err
		}
	}
	start := opt.FromBlock
	if start == 0 && opt.Days > 0 {
		start = BlockAt(time.Now().Add(-time.Duration(opt.Days * float64(24*time.Hour))))
	}
	type span struct {
		version int
		lo, hi  uint64
	}
	var plan []span
	versions := []struct {
		v     int
		floor uint64
	}{{V4Scan, V4FirstBlock}}
	if opt.IncludeV3 {
		versions = append(versions, struct {
			v     int
			floor uint64
		}{3, V3FirstBlock})
	}
	for _, v := range versions {
		lo := max(start, v.floor)
		if lo > head {
			continue
		}
		var gaps [][2]uint64
		for _, a := range addrs {
			have, err := x.Store.Scanned(a, v.v)
			if err != nil {
				return 0, err
			}
			gaps = append(gaps, missing(lo, head, have)...)
		}
		for _, g := range mergeRanges(gaps) {
			plan = append(plan, span{v.v, g[0], g[1]})
		}
	}
	var total, done uint64
	for _, s := range plan {
		total += s.hi - s.lo + 1
	}
	watch := lowerSet(addrs)
	found := 0
	for _, s := range plan {
		step := x.step()
		if s.version == 3 {
			step *= 5 // V3 logs are filtered by address at the node, so ranges can be wider
		}
		for lo := s.lo; lo <= s.hi; {
			hi := min(lo+step-1, s.hi)
			events, err := x.fetch(ctx, s.version, lo, hi, addrs)
			if isRangeTooLarge(err) && step > 50 {
				step /= 2 // this node caps log ranges or result sizes: retry the chunk smaller
				continue
			}
			if err != nil {
				return found, err
			}
			var mine []*Event
			for _, e := range events {
				if e.Pays(watch) {
					mine = append(mine, e)
				}
			}
			if err := x.Store.Save(mine, addrs, s.version, lo, hi); err != nil {
				return found, err
			}
			found += len(mine)
			done += hi - lo + 1
			if opt.Progress != nil {
				opt.Progress(done, total, found)
			}
			lo = hi + 1
		}
	}
	return found, nil
}

// Head returns the latest block number.
func (x *Indexer) Head(ctx context.Context) (uint64, error) {
	var h string
	if err := x.call(ctx, "eth_blockNumber", []any{}, &h); err != nil {
		return 0, err
	}
	return strconv.ParseUint(strings.TrimPrefix(h, "0x"), 16, 64)
}

// BlockAt is the Base block produced at t (Base makes one every 2 seconds).
func BlockAt(t time.Time) uint64 {
	s := t.Unix() - BaseGenesisTimestamp
	if s < 0 {
		return 0
	}
	return uint64(s / 2)
}

func (x *Indexer) step() uint64 {
	if x.Step == 0 {
		return 2000
	}
	return x.Step
}

func (x *Indexer) fetch(ctx context.Context, version int, lo, hi uint64, addrs []string) ([]*Event, error) {
	span := map[string]any{"fromBlock": "0x" + strconv.FormatUint(lo, 16), "toBlock": "0x" + strconv.FormatUint(hi, 16)}
	var logs []Log
	if version == V4Scan {
		// both V4 payout events in one call: topic0 is either
		span["topics"] = []any{[]string{TopicMarketRewardsV4, TopicCreatorCoinRewards}}
		if err := x.call(ctx, "eth_getLogs", []any{span}, &logs); err != nil {
			return nil, err
		}
	} else {
		topics := make([]string, len(addrs))
		for i, a := range addrs {
			topics[i] = AddressTopic(a)
		}
		for pos := 1; pos <= 3; pos++ { // payoutRecipient, platformReferrer, tradeReferrer
			filter := []any{TopicTradeRewardsV3, nil, nil, nil}
			filter[pos] = topics
			span["topics"] = filter
			var part []Log
			if err := x.call(ctx, "eth_getLogs", []any{span}, &part); err != nil {
				return nil, err
			}
			logs = append(logs, part...)
		}
	}
	seen := map[string]bool{}
	var out []*Event
	for _, l := range logs {
		if e, ok := DecodeLog(l); ok && !seen[eventKey(e)] {
			seen[eventKey(e)] = true
			out = append(out, e)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].Block < out[j].Block || (out[i].Block == out[j].Block && out[i].LogIndex < out[j].LogIndex)
	})
	return out, nil
}

// RPCError is an error answer from the JSON-RPC node.
type RPCError struct {
	Method  string
	Code    int
	Message string
}

func (e *RPCError) Error() string { return fmt.Sprintf("rpc %s: %d %s", e.Method, e.Code, e.Message) }

func isRangeTooLarge(err error) bool {
	var re *RPCError
	if !errors.As(err, &re) {
		return false
	}
	m := strings.ToLower(re.Message)
	if strings.Contains(m, "rate") {
		return false // "rate limit exceeded" is not about the range
	}
	for _, s := range []string{"range", "too many", "limit exceeded", "10000 results", "block range", "response size"} {
		if strings.Contains(m, s) {
			return true
		}
	}
	return false
}

func (x *Indexer) call(ctx context.Context, method string, params []any, out any) error {
	body, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
	retries := x.MaxRetries
	if retries == 0 {
		retries = 5
	}
	var last error
	for attempt := 0; attempt <= retries; attempt++ {
		if attempt > 0 {
			t := time.NewTimer(min(time.Duration(1<<attempt)*time.Second, 20*time.Second))
			select {
			case <-ctx.Done():
				t.Stop()
				return ctx.Err()
			case <-t.C:
			}
		}
		req, err := http.NewRequestWithContext(ctx, "POST", x.RPCURL, bytes.NewReader(body))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")
		resp, err := x.HTTP.Do(req)
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			last = err
			continue
		}
		data, err := io.ReadAll(io.LimitReader(resp.Body, 256<<20))
		resp.Body.Close()
		if err != nil {
			last = err
			continue
		}
		if resp.StatusCode == 429 || resp.StatusCode >= 500 {
			last = fmt.Errorf("rpc %s: HTTP %d", method, resp.StatusCode)
			continue
		}
		var r struct {
			Result json.RawMessage `json:"result"`
			Error  *struct {
				Code    int    `json:"code"`
				Message string `json:"message"`
			} `json:"error"`
		}
		if err := json.Unmarshal(data, &r); err != nil {
			return fmt.Errorf("rpc %s: HTTP %d, not JSON-RPC: %.200s", method, resp.StatusCode, data)
		}
		if r.Error != nil {
			rpcErr := &RPCError{method, r.Error.Code, r.Error.Message}
			m := strings.ToLower(r.Error.Message)
			if strings.Contains(m, "rate") || strings.Contains(m, "timeout") || strings.Contains(m, "busy") {
				last = rpcErr
				continue
			}
			return rpcErr
		}
		return json.Unmarshal(r.Result, out)
	}
	return last
}

func normalise(addresses []string) ([]string, error) {
	set := lowerSet(addresses)
	out := make([]string, 0, len(set))
	for a := range set {
		if len(a) != 42 || !strings.HasPrefix(a, "0x") {
			return nil, fmt.Errorf("rewards: %q is not an address", a)
		}
		out = append(out, a)
	}
	if len(out) == 0 {
		return nil, errors.New("rewards: no addresses to scan")
	}
	sort.Strings(out)
	return out, nil
}
