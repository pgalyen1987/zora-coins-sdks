package zora_test

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"

	"github.com/pgalyen1987/zora-coins-sdks/go/zora"
)

func ExampleClient_Coin() {
	client := zora.NewClient()
	coin, err := client.Coin(context.Background(), "0x0b8590d3c0b1ee6c797e184a4afbb15f8f58a46b", nil)
	if errors.Is(err, zora.ErrNotFound) {
		log.Fatal("no such coin")
	} else if err != nil {
		log.Fatal(err)
	}
	fmt.Println(coin.GetName(), coin.GetSymbol(), coin.GetMarketCap(), coin.GetUniqueHolders())
}

func ExampleClient_IterExplore() {
	client := zora.NewClient()
	ctx := context.Background()
	n := 0
	for coin, err := range client.IterExplore(ctx, zora.ListTypeTopGainers, &zora.ExploreParams{PageSize: 20}) {
		if err != nil {
			log.Fatal(err)
		}
		fmt.Printf("%-12s %s\n", coin.GetSymbol(), coin.GetMarketCapDelta24h())
		if n++; n == 50 {
			break // pages are fetched only as the loop needs them
		}
	}
}

func ExampleClient_ProfileCoins() {
	client := zora.NewClient()
	// One page of coins a profile created, keeping only those launched through your app.
	page, err := client.ProfileCoins(context.Background(), "rebelstudios", &zora.ProfileCoinsParams{
		PageSize:                20,
		PlatformReferrerAddress: []string{"0xYourPlatformReferrer"},
	})
	if err != nil {
		log.Fatal(err)
	}
	for _, coin := range page.Nodes() {
		fmt.Println(coin.GetName(), coin.GetAddress())
	}
	if next := page.NextCursor(); next != "" {
		fmt.Println("more after", next)
	}
}

func ExampleClient_QuoteTrade() {
	client := zora.NewClient(zora.WithAPIKey(os.Getenv("ZORA_API_KEY")))
	// Buy a coin with 0.001 ETH. Nothing is signed or sent: the call goes to your wallet.
	q, err := client.QuoteTrade(context.Background(), zora.ETH(), zora.ERC20("0x0b8590d3c0b1ee6c797e184a4afbb15f8f58a46b"),
		"1000000000000000", "0xYourWallet", &zora.QuoteRequest{Referrer: zora.Ptr("0xYourReferrer")})
	if err != nil {
		log.Fatal(err)
	}
	call := q.GetCall()
	fmt.Println("send to", call.GetTarget(), "value", call.GetValue(), "calldata bytes", len(call.GetData())/2-1)
	fmt.Println("expected out", q.GetQuote().GetAmountOut())
}

func ExampleGraphQLClient_Query() {
	gql := zora.NewGraphQLClient("http://localhost:8080/graphql")
	var out struct {
		Coin    *zora.Zora20Token `json:"coin"`
		Profile *zora.Profile     `json:"profile"`
	}
	// One request, exactly the fields the screen needs, decoded into the same types as REST.
	err := gql.Query(context.Background(), `query($coin: String!, $who: String!) {
		coin(address: $coin) { name symbol marketCap uniqueHolders }
		profile(identifier: $who) { handle avatar { medium } }
	}`, map[string]any{"coin": "0x0b8590d3c0b1ee6c797e184a4afbb15f8f58a46b", "who": "rebelstudios"}, &out)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(out.Coin.GetName(), out.Profile.GetHandle())
}
