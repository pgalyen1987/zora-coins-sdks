package zora

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
)

// ErrNotFound is returned (wrapped) when a lookup — a coin, a profile, a token — finds nothing.
//
//	coin, err := client.Coin(ctx, addr, nil)
//	if errors.Is(err, zora.ErrNotFound) { ... }
var ErrNotFound = errors.New("zora: not found")

// APIError is returned when the Zora API answers with an HTTP error.
type APIError struct {
	StatusCode int    // HTTP status
	Message    string // the API's error message, if it sent one
	Path       string // the endpoint that failed, e.g. "/coin"
	// ErrorType is the API's machine-readable reason, where it gives one. /quote answers 422 with
	// "LIQUIDITY" when the pool can't fill the trade, or "UNKNOWN".
	ErrorType string
	Body      []byte // the raw response body
}

func (e *APIError) Error() string {
	return fmt.Sprintf("zora: %s: %d %s", e.Path, e.StatusCode, e.Message)
}

// RateLimited reports whether Zora refused the request for exceeding the rate limit, after the
// client's retries were used up. An API key raises the limit.
func (e *APIError) RateLimited() bool { return e.StatusCode == http.StatusTooManyRequests }

// InsufficientLiquidity reports whether a quote failed because the pool can't fill a trade that
// size. Try a smaller amount.
func (e *APIError) InsufficientLiquidity() bool { return e.ErrorType == "LIQUIDITY" }

// Is lets errors.Is(err, zora.ErrNotFound) match a 404 from the API as well.
func (e *APIError) Is(target error) bool {
	return target == ErrNotFound && e.StatusCode == http.StatusNotFound
}

func newAPIError(status int, path string, body []byte) *APIError {
	msg := http.StatusText(status)
	var parsed struct {
		Error     any    `json:"error"`
		Message   string `json:"message"`
		ErrorType string `json:"errorType"`
	}
	if json.Unmarshal(body, &parsed) == nil {
		switch v := parsed.Error.(type) {
		case string:
			msg = v
		case map[string]any:
			if m, ok := v["message"].(string); ok {
				msg = m
			}
		}
		if parsed.Message != "" {
			msg = parsed.Message
		}
	} else if s := strings.TrimSpace(string(body)); s != "" {
		msg = s
		if len(msg) > 300 {
			msg = msg[:300]
		}
	}
	return &APIError{StatusCode: status, Message: msg, Path: path, ErrorType: parsed.ErrorType, Body: body}
}
