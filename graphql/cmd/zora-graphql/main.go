// Command zora-graphql serves the Zora Coins API as one GraphQL schema.
//
//	go run github.com/pgalyen1987/zora-coins-sdks/graphql/cmd/zora-graphql@latest -addr :8080
//	open http://localhost:8080            # GraphiQL playground
//
// Callers send their own Zora API key in the api-key header; the gateway forwards it and keeps
// nothing. Set ZORA_API_KEY only for a private deployment that should use your key by default.
package main

import (
	"flag"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/pgalyen1987/zora-coins-sdks/graphql/gateway"
)

func main() {
	addr := flag.String("addr", ":"+envOr("PORT", "8080"), "listen address")
	rpc := flag.String("rpc", os.Getenv("BASE_RPC_URL"), "Base RPC for the rewards query (default: Base's public RPC)")
	flag.Parse()
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	srv, err := gateway.New(gateway.Config{ServerAPIKey: os.Getenv("ZORA_API_KEY"), RPCURL: *rpc, Logger: log}, gateway.SDL)
	if err != nil {
		log.Error("schema", "err", err)
		os.Exit(1)
	}
	log.Info("zora-graphql listening", "addr", *addr)
	s := &http.Server{Addr: *addr, Handler: srv, ReadHeaderTimeout: 10 * time.Second, WriteTimeout: 90 * time.Second}
	if err := s.ListenAndServe(); err != nil {
		log.Error("serve", "err", err)
		os.Exit(1)
	}
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
