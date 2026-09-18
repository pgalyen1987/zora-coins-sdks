// Command zora-rewards reports what addresses earned from Zora coin trading fees — as a creator,
// platform referrer or trade referrer — read straight from Base.
//
//	go install github.com/pgalyen1987/zora-coins-sdks/go/cmd/zora-rewards@latest
//	zora-rewards 0xYourAddress                     # last 30 days: scan, then print the report
//	zora-rewards -days 7 -html rewards.html 0xA 0xB
//	zora-rewards -json 0xA > rewards.json
//
// Scans are saved (zora-rewards.json by default), so running it again only fetches new blocks.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/signal"

	"github.com/pgalyen1987/zora-coins-sdks/go/rewards"
	"github.com/pgalyen1987/zora-coins-sdks/go/zora"
)

func main() {
	fs := flag.NewFlagSet("zora-rewards", flag.ExitOnError)
	days := fs.Float64("days", 30, "how far back to scan")
	from := fs.Uint64("from-block", 0, "scan from this block instead of -days")
	v3 := fs.Bool("v3", false, "also scan legacy V3 coins (CoinTradeRewards)")
	rpc := fs.String("rpc", rewards.DefaultRPC, "Base JSON-RPC URL (a private RPC is much faster)")
	db := fs.String("db", "zora-rewards.json", "where scanned events are kept between runs")
	htmlOut := fs.String("html", "", "also write an HTML report to this file")
	asJSON := fs.Bool("json", false, "print the report as JSON")
	noScan := fs.Bool("no-scan", false, "report from what is already stored, without scanning")
	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "usage: zora-rewards [flags] ADDRESS...\n\nReports the Zora creator and referral rewards paid to addresses on Base.\n\nflags:")
		fs.PrintDefaults()
	}
	fs.Parse(os.Args[1:])
	addrs := fs.Args()
	if len(addrs) == 0 {
		fs.Usage()
		os.Exit(2)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	store, err := rewards.OpenFileStore(*db)
	die(err)
	idx := rewards.NewIndexer(store, *rpc)
	if !*noScan {
		opt := rewards.ScanOptions{Days: *days, FromBlock: *from, IncludeV3: *v3,
			Progress: func(done, total uint64, found int) {
				pct := 100.0
				if total > 0 {
					pct = 100 * float64(done) / float64(total)
				}
				fmt.Fprintf(os.Stderr, "\r  scanned %d/%d blocks (%.0f%%) · %d matching reward events", done, total, pct, found)
			}}
		if *from > 0 {
			opt.Days = 0
		}
		n, err := idx.Scan(ctx, addrs, opt)
		fmt.Fprintln(os.Stderr)
		die(err)
		fmt.Fprintf(os.Stderr, "  %d new reward events saved to %s\n", n, *db)
	}
	events, err := store.EventsFor(addrs, 0)
	die(err)
	report, err := rewards.BuildReport(ctx, events, addrs, zora.NewClient())
	die(err)
	if *asJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", " ")
		die(enc.Encode(struct {
			*rewards.Report
			TotalUSD float64 `json:"totalUsd"`
		}{report, report.TotalUSD()}))
	} else {
		fmt.Print(report.Text())
	}
	if *htmlOut != "" {
		die(os.WriteFile(*htmlOut, []byte(report.HTML("Zora rewards")), 0o644))
		fmt.Fprintf(os.Stderr, "  wrote %s\n", *htmlOut)
	}
}

func die(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, "zora-rewards:", err)
		os.Exit(1)
	}
}
