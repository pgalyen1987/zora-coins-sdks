package gateway

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/graphql-go/graphql"
	"github.com/graphql-go/graphql/language/ast"
	"github.com/graphql-go/graphql/language/parser"
	"github.com/pgalyen1987/zora-coins-sdks/go/rewards"
	"github.com/pgalyen1987/zora-coins-sdks/go/zora"
)

// Config controls a Server. The zero value is a sensible public deployment.
type Config struct {
	// ServerAPIKey, if set, is used for requests that bring no key of their own. Leave it empty on a
	// public deployment: Zora's terms don't allow redistributing their data commercially without
	// permission, so a public gateway should only ever act with its caller's own key.
	ServerAPIKey string
	// ZoraBaseURL overrides Zora's API (tests, staging).
	ZoraBaseURL string
	// RPCURL is the Base RPC for the rewards query (rewards.DefaultRPC if empty).
	RPCURL string
	// MaxRootFields caps top-level fields per request; each is one call to Zora (default 10).
	MaxRootFields int
	// MaxRewardHours caps the rewards query's scan window (default 24).
	MaxRewardHours float64
	// Timeout bounds one request end to end (default 60s).
	Timeout time.Duration
	Logger  *slog.Logger
}

// Server is an http.Handler serving GraphQL at /graphql, a GraphiQL playground at /, the SDL at
// /schema.graphql and a health check at /health.
type Server struct {
	cfg    Config
	schema graphql.Schema
	sdl    []byte
}

type ctxKey struct{}

// New builds a Server. sdl is served verbatim at /schema.graphql.
func New(cfg Config, sdl []byte) (*Server, error) {
	if cfg.MaxRootFields == 0 {
		cfg.MaxRootFields = 10
	}
	if cfg.MaxRewardHours == 0 {
		cfg.MaxRewardHours = 24
	}
	if cfg.Timeout == 0 {
		cfg.Timeout = 60 * time.Second
	}
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	s := &Server{cfg: cfg, sdl: sdl}
	schema, err := NewSchema(s.resolveRoot)
	if err != nil {
		return nil, err
	}
	s.schema = schema
	return s, nil
}

func (s *Server) resolveRoot(p graphql.ResolveParams, field string) (any, error) {
	c, _ := p.Context.Value(ctxKey{}).(*zora.Client)
	if c == nil {
		return nil, errors.New("gateway: no client in context")
	}
	var (
		v   any
		err error
	)
	if field == "rewards" {
		v, err = s.rewards(p.Context, c, p.Args)
	} else {
		v, err = callSDK(p.Context, c, field, p.Args)
	}
	if errors.Is(err, zora.ErrNotFound) {
		return nil, nil // GraphQL's way to say "no such coin": null, not an error
	}
	if err != nil {
		return nil, publicError(err)
	}
	return toJSONValue(v)
}

// ServeHTTP implements http.Handler.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Headers", "content-type, api-key, authorization")
	switch {
	case r.Method == http.MethodOptions:
		w.WriteHeader(http.StatusNoContent)
	case r.URL.Path == "/health":
		w.Write([]byte("ok"))
	case r.URL.Path == "/schema.graphql":
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Write(s.sdl)
	case r.URL.Path == "/graphql":
		s.serveGraphQL(w, r)
	case r.URL.Path == "/" && r.Method == http.MethodGet:
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte(playground))
	default:
		http.NotFound(w, r)
	}
}

type request struct {
	Query         string         `json:"query"`
	Variables     map[string]any `json:"variables"`
	OperationName string         `json:"operationName"`
}

func (s *Server) serveGraphQL(w http.ResponseWriter, r *http.Request) {
	var req request
	switch r.Method {
	case http.MethodGet:
		req.Query, req.OperationName = r.URL.Query().Get("query"), r.URL.Query().Get("operationName")
		if v := r.URL.Query().Get("variables"); v != "" {
			if err := json.Unmarshal([]byte(v), &req.Variables); err != nil {
				writeErrors(w, http.StatusBadRequest, "variables is not JSON")
				return
			}
		}
	case http.MethodPost:
		body, err := io.ReadAll(io.LimitReader(r.Body, 64<<10+1))
		if err != nil || len(body) > 64<<10 {
			writeErrors(w, http.StatusRequestEntityTooLarge, "request body over 64 KB")
			return
		}
		if err := json.Unmarshal(body, &req); err != nil {
			writeErrors(w, http.StatusBadRequest, "body must be JSON: {\"query\": ..., \"variables\": {...}}")
			return
		}
	default:
		writeErrors(w, http.StatusMethodNotAllowed, "use GET or POST")
		return
	}
	if strings.TrimSpace(req.Query) == "" {
		writeErrors(w, http.StatusBadRequest, "no query")
		return
	}
	if n, err := rootFieldCount(req.Query); err == nil && n > s.cfg.MaxRootFields {
		writeErrors(w, http.StatusBadRequest, fmt.Sprintf("%d top-level fields; the limit is %d per request", n, s.cfg.MaxRootFields))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.Timeout)
	defer cancel()
	ctx = context.WithValue(ctx, ctxKey{}, s.clientFor(r))
	start := time.Now()
	res := graphql.Do(graphql.Params{Schema: s.schema, RequestString: req.Query, VariableValues: req.Variables,
		OperationName: req.OperationName, Context: ctx})
	s.cfg.Logger.Info("graphql", "op", req.OperationName, "ms", time.Since(start).Milliseconds(), "errors", len(res.Errors))
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(res)
}

// clientFor makes a Zora client carrying the caller's own API key (api-key header, or
// Authorization: Bearer), falling back to the server's key only if one is configured.
func (s *Server) clientFor(r *http.Request) *zora.Client {
	key := r.Header.Get("api-key")
	if key == "" {
		if a := r.Header.Get("Authorization"); strings.HasPrefix(strings.ToLower(a), "bearer ") {
			key = strings.TrimSpace(a[7:])
		}
	}
	if key == "" {
		key = s.cfg.ServerAPIKey
	}
	opts := []zora.Option{zora.WithAPIKey(key), zora.WithUserAgent("zora-coins-graphql")}
	if s.cfg.ZoraBaseURL != "" {
		opts = append(opts, zora.WithBaseURL(s.cfg.ZoraBaseURL))
	}
	return zora.NewClient(opts...)
}

func (s *Server) rewards(ctx context.Context, c *zora.Client, args map[string]any) (any, error) {
	addrs := strs(args["addresses"])
	if len(addrs) == 0 || len(addrs) > 20 {
		return nil, errors.New("give between 1 and 20 addresses")
	}
	hours := 6.0
	if h, ok := args["hours"].(float64); ok {
		hours = h
	}
	if hours <= 0 || hours > s.cfg.MaxRewardHours {
		return nil, fmt.Errorf("hours must be between 0 and %g", s.cfg.MaxRewardHours)
	}
	store := rewards.NewMemoryStore()
	idx := rewards.NewIndexer(store, s.cfg.RPCURL)
	if _, err := idx.Scan(ctx, addrs, rewards.ScanOptions{Days: hours / 24}); err != nil {
		return nil, err
	}
	events, err := store.EventsFor(addrs, 0)
	if err != nil {
		return nil, err
	}
	rep, err := rewards.BuildReport(ctx, events, addrs, c)
	if err != nil {
		return nil, err
	}
	lines := make([]map[string]any, 0, len(rep.Lines))
	for _, l := range rep.Lines {
		line := map[string]any{"role": string(l.Role), "token": l.Token, "raw": l.Raw.String(), "amount": rep.Amount(l), "payouts": l.Payouts}
		if t := rep.Tokens[l.Token]; t != nil {
			line["symbol"] = t.Symbol
		}
		if v, ok := rep.USD(l); ok {
			line["usd"] = v
		}
		lines = append(lines, line)
	}
	return map[string]any{"addresses": rep.Addresses, "events": rep.Events, "fromBlock": rep.FirstBlock,
		"toBlock": rep.LastBlock, "totalUsd": rep.TotalUSD(), "lines": lines}, nil
}

// rootFieldCount counts top-level selections across operations, so one request can't fan out
// into hundreds of upstream calls.
func rootFieldCount(q string) (int, error) {
	doc, err := parser.Parse(parser.ParseParams{Source: q})
	if err != nil {
		return 0, err
	}
	n := 0
	for _, d := range doc.Definitions {
		if op, ok := d.(*ast.OperationDefinition); ok && op.SelectionSet != nil {
			n += len(op.SelectionSet.Selections)
		}
	}
	return n, nil
}

// publicError keeps Zora's own message (status and text) but drops transport detail.
func publicError(err error) error {
	var apiErr *zora.APIError
	if errors.As(err, &apiErr) {
		msg := "zora api " + strconv.Itoa(apiErr.StatusCode) + ": " + apiErr.Message
		if apiErr.RateLimited() {
			msg += " (send your own Zora API key in the api-key header for higher limits)"
		}
		return errors.New(msg)
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return errors.New("timed out")
	}
	return err
}

func writeErrors(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]any{"errors": []map[string]string{{"message": msg}}})
}

// ---- argument helpers used by the generated resolvers ------------------------------------------

func str(v any) string {
	s, _ := v.(string)
	return s
}

func integer(v any) int {
	switch x := v.(type) {
	case int:
		return x
	case float64:
		return int(x)
	}
	return 0
}

func boolPtr(v any) *bool {
	if b, ok := v.(bool); ok {
		return &b
	}
	return nil
}

func ints(v any) []int {
	list, _ := v.([]any)
	out := make([]int, 0, len(list))
	for _, x := range list {
		out = append(out, integer(x))
	}
	return out
}

func strs(v any) []string {
	list, _ := v.([]any)
	out := make([]string, 0, len(list))
	for _, x := range list {
		if s, ok := x.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

func remarshal(in, out any) error {
	b, err := json.Marshal(in)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, out)
}

// toJSONValue turns an SDK result into plain maps and slices keyed by the API's JSON names, which
// the schema's field resolvers read.
func toJSONValue(v any) (any, error) {
	b, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	var out any
	return out, json.Unmarshal(b, &out)
}

type errUnknownField string

func (e errUnknownField) Error() string { return "gateway: no resolver for " + string(e) }
