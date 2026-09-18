package zora

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math/rand/v2"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

// Version is the SDK version, sent in the User-Agent header.
const Version = "0.1.0"

// DefaultBaseURL is Zora's production REST API.
const DefaultBaseURL = "https://api-sdk.zora.engineering"

// BaseChainID is Base mainnet, where Zora coins live. Every call defaults to it.
const BaseChainID = 8453

// Client talks to the Zora Coins REST API. It is safe for concurrent use; create one and reuse it.
//
// Every method takes a context, retries rate limits (429) and server errors (5xx) with backoff,
// honouring Retry-After, and returns an *APIError when the API says no.
type Client struct {
	baseURL    string
	apiKey     string
	userAgent  string
	http       *http.Client
	maxRetries int
}

// Option configures a Client.
type Option func(*Client)

// WithAPIKey sets the API key sent as the api-key header. Without one Zora applies much lower rate
// limits. Create a key at https://zora.co/settings/developer. NewClient also reads ZORA_API_KEY.
func WithAPIKey(key string) Option { return func(c *Client) { c.apiKey = key } }

// WithBaseURL points the client at another deployment (staging, a mock server in tests).
func WithBaseURL(u string) Option { return func(c *Client) { c.baseURL = strings.TrimRight(u, "/") } }

// WithHTTPClient replaces the default *http.Client (30s timeout), e.g. to add tracing or a proxy.
func WithHTTPClient(h *http.Client) Option { return func(c *Client) { c.http = h } }

// WithMaxRetries sets how many times a rate-limited or failed request is retried (default 3).
func WithMaxRetries(n int) Option { return func(c *Client) { c.maxRetries = n } }

// WithUserAgent prefixes the User-Agent header, so Zora can tell your app's traffic apart.
func WithUserAgent(ua string) Option {
	return func(c *Client) { c.userAgent = ua + " " + c.userAgent }
}

// NewClient returns a client for the Zora Coins API. With no WithAPIKey option it uses the
// ZORA_API_KEY environment variable if set.
//
//	client := zora.NewClient()
//	coin, err := client.Coin(ctx, "0x0b8590d3c0b1ee6c797e184a4afbb15f8f58a46b", nil)
func NewClient(opts ...Option) *Client {
	c := &Client{
		baseURL:    DefaultBaseURL,
		apiKey:     os.Getenv("ZORA_API_KEY"),
		userAgent:  "zora-coins-go/" + Version,
		http:       &http.Client{Timeout: 30 * time.Second},
		maxRetries: 3,
	}
	for _, o := range opts {
		o(c)
	}
	return c
}

// Do sends one request and decodes the JSON response into out. The generated methods are built on
// it; call it directly only for an endpoint this SDK doesn't wrap yet.
func (c *Client) Do(ctx context.Context, method, path string, query url.Values, body, out any) error {
	var payload []byte
	if body != nil {
		var err error
		if payload, err = json.Marshal(body); err != nil {
			return fmt.Errorf("zora: encoding request: %w", err)
		}
	}
	u := c.baseURL + path
	if len(query) > 0 {
		u += "?" + query.Encode()
	}
	for attempt := 0; ; attempt++ {
		req, err := http.NewRequestWithContext(ctx, method, u, bytes.NewReader(payload))
		if err != nil {
			return err
		}
		req.Header.Set("Accept", "application/json")
		req.Header.Set("User-Agent", c.userAgent)
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		if c.apiKey != "" {
			req.Header.Set("api-key", c.apiKey)
		}
		resp, err := c.http.Do(req)
		if err != nil {
			if ctx.Err() != nil || attempt >= c.maxRetries {
				return fmt.Errorf("zora: %s %s: %w", method, path, err)
			}
			if err := sleep(ctx, backoff(attempt, "")); err != nil {
				return err
			}
			continue
		}
		data, err := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
		resp.Body.Close()
		if err != nil {
			return fmt.Errorf("zora: reading %s: %w", path, err)
		}
		if retryable(resp.StatusCode) && attempt < c.maxRetries {
			if err := sleep(ctx, backoff(attempt, resp.Header.Get("Retry-After"))); err != nil {
				return err
			}
			continue
		}
		if resp.StatusCode >= 400 {
			return newAPIError(resp.StatusCode, path, data)
		}
		if out == nil {
			return nil
		}
		if err := json.Unmarshal(data, out); err != nil {
			return fmt.Errorf("zora: unexpected response from %s: %w", path, err)
		}
		return nil
	}
}

func retryable(status int) bool {
	return status == http.StatusTooManyRequests || status == 500 || status == 502 || status == 503 || status == 504
}

// backoff is exponential with jitter, capped at 8s, and defers to Retry-After (capped at 30s).
func backoff(attempt int, retryAfter string) time.Duration {
	if retryAfter != "" {
		if s, err := strconv.ParseFloat(retryAfter, 64); err == nil && s >= 0 {
			return min(time.Duration(s*float64(time.Second)), 30*time.Second)
		}
		if t, err := http.ParseTime(retryAfter); err == nil {
			return min(max(time.Until(t), 0), 30*time.Second)
		}
	}
	d := time.Duration(min(1<<attempt, 16)) * 500 * time.Millisecond
	return d + time.Duration(rand.Int64N(int64(250*time.Millisecond)))
}

func sleep(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

func chainOrBase(id int) int {
	if id == 0 {
		return BaseChainID
	}
	return id
}
