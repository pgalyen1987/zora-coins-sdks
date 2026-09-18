// Package rewards reads what Zora pays creators and referrers, straight from Base.
//
// Every trade of a Zora coin splits its fee between the coin's creator (the payout recipient), the
// platform that launched the coin, the interface that routed the trade, the protocol, and Doppler.
// On V4 coins those payouts are CoinMarketRewardsV4 events, and none of their fields are indexed:
// no node can answer "rewards paid to this address". This package reads every reward event in a
// block range, keeps the ones that pay the addresses you watch, and remembers what it has scanned so
// a re-run only fetches new blocks.
//
//	idx := rewards.NewIndexer(rewards.NewMemoryStore(), rewards.DefaultRPC)
//	_, err := idx.Scan(ctx, []string{"0xYourAddress"}, rewards.ScanOptions{Days: 7})
//	events, _ := idx.Store.EventsFor([]string{"0xYourAddress"}, 0)
//	report, err := rewards.BuildReport(ctx, events, []string{"0xYourAddress"}, zora.NewClient())
//	fmt.Println(report.Text())
package rewards

import (
	"encoding/hex"
	"math/big"
	"strconv"
	"strings"
	"time"
)

// Event signatures (topic 0).
const (
	// TopicMarketRewardsV4 is keccak256 of
	// CoinMarketRewardsV4(address,address,address,address,address,address,address,(uint256×10)).
	TopicMarketRewardsV4 = "0x35b5031218696db1dfd903223a47f38e66a1998e14a942a5d60fddaa49a685fc"
	// TopicTradeRewardsV3 is keccak256 of
	// CoinTradeRewards(address,address,address,address,uint256,uint256,uint256,uint256,address).
	TopicTradeRewardsV3 = "0x6b67f906562afcdc3afeeeb6754e906cc24d9ce090e9db1b7b68e6462682d966"
)

// ZeroAddress marks "nobody" in a recipient field, and native ETH as a currency.
const ZeroAddress = "0x0000000000000000000000000000000000000000"

// BaseGenesisTimestamp is when Base produced block 0. Base makes a block exactly every 2 seconds, so a block's time is
// genesis + 2 × number with no RPC call.
const BaseGenesisTimestamp = 1686789347

// Role is who a payout goes to.
type Role string

// The five payout roles, in report order.
const (
	RoleCreator          Role = "creator"
	RolePlatformReferrer Role = "platform_referrer"
	RoleTradeReferrer    Role = "trade_referrer"
	RoleProtocol         Role = "protocol"
	RoleDoppler          Role = "doppler"
)

// Roles lists every role in report order.
var Roles = []Role{RoleCreator, RolePlatformReferrer, RoleTradeReferrer, RoleProtocol, RoleDoppler}

// Label is a role's human name.
func (r Role) Label() string {
	return map[Role]string{RoleCreator: "Creator payouts", RolePlatformReferrer: "Platform referral",
		RoleTradeReferrer: "Trade referral", RoleProtocol: "Protocol", RoleDoppler: "Doppler"}[r]
}

// Payout is what one role received in one event. Currency is paid in Event.Currency (ZORA, ETH,
// USDC or a creator coin); Coin is paid in the traded coin itself (V4 only).
type Payout struct {
	Recipient string   `json:"recipient"`
	Currency  *big.Int `json:"currency"`
	Coin      *big.Int `json:"coin"`
}

// Event is one reward distribution. Amounts are exact integers in the token's smallest unit.
type Event struct {
	Block    uint64          `json:"block"`
	TxHash   string          `json:"txHash"`
	LogIndex uint64          `json:"logIndex"`
	Emitter  string          `json:"emitter"`
	Version  int             `json:"version"` // 4 or 3
	Coin     string          `json:"coin"`
	Currency string          `json:"currency"`
	Payouts  map[Role]Payout `json:"payouts"`
}

// Time is when the event's block was produced.
func (e *Event) Time() time.Time {
	return time.Unix(BaseGenesisTimestamp+2*int64(e.Block), 0).UTC()
}

// Pays reports whether any of the addresses (lowercase) received a payout in this event.
func (e *Event) Pays(addresses map[string]bool) bool {
	for _, p := range e.Payouts {
		if p.Recipient != ZeroAddress && addresses[p.Recipient] {
			return true
		}
	}
	return false
}

// Log is an eth_getLogs entry, as JSON-RPC returns it.
type Log struct {
	Address         string   `json:"address"`
	Topics          []string `json:"topics"`
	Data            string   `json:"data"`
	BlockNumber     string   `json:"blockNumber"`
	TransactionHash string   `json:"transactionHash"`
	LogIndex        string   `json:"logIndex"`
}

// DecodeLog turns a log into an Event, or returns ok=false if it is not a Zora reward event.
func DecodeLog(l Log) (e *Event, ok bool) {
	if len(l.Topics) == 0 {
		return nil, false
	}
	words := splitWords(l.Data)
	block, _ := strconv.ParseUint(strings.TrimPrefix(l.BlockNumber, "0x"), 16, 64)
	idx, _ := strconv.ParseUint(strings.TrimPrefix(l.LogIndex, "0x"), 16, 64)
	base := Event{Block: block, TxHash: strings.ToLower(l.TransactionHash), LogIndex: idx, Emitter: strings.ToLower(l.Address)}
	switch strings.ToLower(l.Topics[0]) {
	case TopicMarketRewardsV4:
		if len(words) < 17 {
			return nil, false
		}
		base.Version, base.Coin, base.Currency = 4, addr(words[0]), addr(words[1])
		base.Payouts = map[Role]Payout{
			RoleCreator:          {addr(words[2]), word(words[7]), word(words[8])},
			RolePlatformReferrer: {addr(words[3]), word(words[9]), word(words[10])},
			RoleTradeReferrer:    {addr(words[4]), word(words[11]), word(words[12])},
			RoleProtocol:         {addr(words[5]), word(words[13]), word(words[14])},
			RoleDoppler:          {addr(words[6]), word(words[15]), word(words[16])},
		}
		return &base, true
	case TopicTradeRewardsV3:
		if len(l.Topics) < 4 || len(words) < 6 {
			return nil, false
		}
		// indexed: payoutRecipient, platformReferrer, tradeReferrer; the coin is the emitter
		zero := new(big.Int)
		base.Version, base.Coin, base.Currency = 3, base.Emitter, addr(words[5])
		base.Payouts = map[Role]Payout{
			RoleCreator:          {addr(hexWord(l.Topics[1])), word(words[1]), zero},
			RolePlatformReferrer: {addr(hexWord(l.Topics[2])), word(words[2]), zero},
			RoleTradeReferrer:    {addr(hexWord(l.Topics[3])), word(words[3]), zero},
			RoleProtocol:         {addr(words[0]), word(words[4]), zero},
			RoleDoppler:          {ZeroAddress, zero, zero},
		}
		return &base, true
	}
	return nil, false
}

// AddressTopic left-pads an address to a 32-byte topic, for filtering indexed V3 fields.
func AddressTopic(address string) string {
	return "0x" + strings.Repeat("0", 24) + strings.ToLower(strings.TrimPrefix(address, "0x"))
}

func splitWords(data string) [][]byte {
	b, err := hex.DecodeString(strings.TrimPrefix(data, "0x"))
	if err != nil {
		return nil
	}
	var out [][]byte
	for i := 0; i+32 <= len(b); i += 32 {
		out = append(out, b[i:i+32])
	}
	return out
}

func hexWord(topic string) []byte {
	b, _ := hex.DecodeString(strings.TrimPrefix(topic, "0x"))
	return b
}

func addr(w []byte) string {
	if len(w) < 20 {
		return ZeroAddress
	}
	return "0x" + hex.EncodeToString(w[len(w)-20:])
}

func word(w []byte) *big.Int { return new(big.Int).SetBytes(w) }
