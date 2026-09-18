package zora

import (
	"context"
	"strings"
)

// Ptr returns a pointer to v, for filling optional request fields:
//
//	req.Slippage = zora.Ptr(0.03)
func Ptr[T any](v T) *T { return &v }

// ETH is native ETH as a trade input or output in QuoteRequest.
func ETH() *TokenSpecInput { return &TokenSpecInput{Type: TokenTypeETH} }

// ERC20 is an ERC-20 token (a Zora coin, ZORA, USDC…) as a trade input or output.
func ERC20(address string) *TokenSpecInput {
	return &TokenSpecInput{Type: TokenTypeERC20, Address: Ptr(address)}
}

// Well-known token addresses on Base.
const (
	WETHAddress = "0x4200000000000000000000000000000000000006"
	USDCAddress = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
	ZORAAddress = "0x1111111111166b7fe7bd91427724b487980afc69"
)

// CoinsByAddress fetches several coins on Base by contract address in one request.
func (c *Client) CoinsByAddress(ctx context.Context, addresses ...string) ([]*Zora20Token, error) {
	refs := make([]*CoinRefInput, len(addresses))
	for i, a := range addresses {
		refs[i] = &CoinRefInput{ChainID: BaseChainID, CollectionAddress: strings.ToLower(a)}
	}
	return c.Coins(ctx, refs)
}

// QuoteTrade is Quote with the usual defaults filled in: the recipient is the sender, slippage is
// 5% and the chain is Base. amountIn is in the input token's smallest unit (wei for ETH).
//
//	q, err := client.QuoteTrade(ctx, zora.ETH(), zora.ERC20(coin), "1000000000000000", wallet, nil)
//	tx := q.GetCall() // To, Data, Value: hand these to your wallet library
func (c *Client) QuoteTrade(ctx context.Context, in, out *TokenSpecInput, amountIn, sender string, opts *QuoteRequest) (*QuoteResponse, error) {
	req := QuoteRequest{}
	if opts != nil {
		req = *opts
	}
	req.TokenIn, req.TokenOut, req.AmountIn, req.Sender = in, out, amountIn, sender
	if req.Recipient == nil {
		req.Recipient = Ptr(sender)
	}
	if req.Slippage == nil {
		req.Slippage = Ptr(0.05)
	}
	if req.ChainID == nil {
		req.ChainID = Ptr(BaseChainID)
	}
	return c.Quote(ctx, &req)
}
