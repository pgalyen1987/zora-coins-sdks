package zora

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

// GraphQLClient queries a zora-coins GraphQL gateway (see graphql/ in this repository): the whole
// Zora Coins API as one GraphQL schema, so a screen's worth of data is one request selecting exactly
// the fields it needs.
//
// Results decode into the same types the REST client returns — every field is optional, so a
// selection simply fills the fields it asked for:
//
//	gql := zora.NewGraphQLClient("http://localhost:8080/graphql")
//	var out struct {
//		Coin *zora.Zora20Token `json:"coin"`
//	}
//	err := gql.Query(ctx, `query($a: String!) { coin(address: $a) { name symbol marketCap } }`,
//		map[string]any{"a": addr}, &out)
//
// The gateway forwards your API key to Zora; it keeps no data of its own.
type GraphQLClient struct {
	c *Client
}

// NewGraphQLClient returns a client for the GraphQL gateway at endpoint. It accepts the same
// options as NewClient (WithAPIKey, WithHTTPClient, WithMaxRetries…) and reads ZORA_API_KEY.
func NewGraphQLClient(endpoint string, opts ...Option) *GraphQLClient {
	return &GraphQLClient{c: NewClient(append([]Option{WithBaseURL(endpoint)}, opts...)...)}
}

// GraphQLError is one entry of a GraphQL response's "errors" array.
type GraphQLError struct {
	Message string `json:"message"`
	Path    []any  `json:"path,omitempty"`
}

// GraphQLErrors is returned when the gateway answers with errors. Data that did resolve is still
// decoded into out, so a partial result is usable.
type GraphQLErrors []GraphQLError

func (e GraphQLErrors) Error() string {
	msgs := make([]string, len(e))
	for i, x := range e {
		msgs[i] = x.Message
		if len(x.Path) > 0 {
			msgs[i] += fmt.Sprintf(" (at %v)", x.Path)
		}
	}
	return "zora graphql: " + strings.Join(msgs, "; ")
}

// Query runs a query (or a quote/createContentCoin operation) and decodes its data into out.
func (g *GraphQLClient) Query(ctx context.Context, query string, variables map[string]any, out any) error {
	var resp struct {
		Data   json.RawMessage `json:"data"`
		Errors GraphQLErrors   `json:"errors"`
	}
	body := map[string]any{"query": query}
	if len(variables) > 0 {
		body["variables"] = variables
	}
	if err := g.c.Do(ctx, "POST", "", nil, body, &resp); err != nil {
		return err
	}
	if out != nil && len(resp.Data) > 0 && string(resp.Data) != "null" {
		if err := json.Unmarshal(resp.Data, out); err != nil {
			return fmt.Errorf("zora graphql: decoding data: %w", err)
		}
	}
	if len(resp.Errors) > 0 {
		return resp.Errors
	}
	return nil
}
