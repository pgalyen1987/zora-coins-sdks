#!/usr/bin/env python3
"""Record real API responses into fixtures/ for every SDK's offline tests.

Fixtures are shared: the Go, Rust, Python, TypeScript, C#, Java and C++ tests all decode the same
recorded payloads, so a type that breaks in one language breaks in all of them. Re-run after the
spec changes:  python3 scripts/record_fixtures.py
"""
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

BASE = "https://api-sdk.zora.engineering"
UA = {"user-agent": "zora-coins-sdks/fixtures", "accept": "application/json"}
OUT = Path(__file__).resolve().parent.parent / "fixtures"
FAT_VANCE = "0x0b8590d3c0b1ee6c797e184a4afbb15f8f58a46b"
ZORA = "0x1111111111166b7fe7bd91427724b487980afc69"
WALLET = "0x8E57BFDE053dBb6862991759c19affC5F383d5D0"


def _fetch(req, attempts=4):
    for i in range(attempts):  # the API's gateway times out now and then; retry like the SDKs do
        try:
            return json.load(urllib.request.urlopen(req, timeout=60))
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503, 504) or i == attempts - 1:
                raise
            time.sleep(2 ** i)


def get(path, query):
    url = BASE + path + "?" + urllib.parse.urlencode(query, doseq=True)
    return _fetch(urllib.request.Request(url, headers=UA))


def post(path, body):
    return _fetch(urllib.request.Request(BASE + path, data=json.dumps(body).encode(), headers={**UA, "content-type": "application/json"}))


def save(name, data):
    (OUT / f"{name}.json").write_text(json.dumps(data, indent=1) + "\n")
    print(f"  {name}.json ({len(json.dumps(data)):,} bytes)")
    time.sleep(0.4)


def main():
    OUT.mkdir(exist_ok=True)
    p1 = get("/explore", {"listType": "TOP_VOLUME_24H", "count": 2})
    save("explore_page1", p1)
    coin = p1["exploreList"]["edges"][0]["node"]["address"]  # a busy coin: real holders, swaps, prices
    save("coin", get("/coin", {"address": coin, "chain": 8453}))
    save("coin_missing", get("/coin", {"address": "0x000000000000000000000000000000000000dead", "chain": 8453}))
    save("explore_page2", get("/explore", {"listType": "TOP_VOLUME_24H", "count": 2, "after": p1["exploreList"]["pageInfo"]["endCursor"]}))
    save("coin_holders", get("/coinHolders", {"address": coin, "chainId": 8453, "count": 3}))
    save("coin_swaps", get("/coinSwaps", {"address": coin, "chain": 8453, "first": 3}))
    save("price_history", get("/coinPriceHistory", {"address": coin, "chain": 8453}))
    save("profile", get("/profile", {"identifier": "jacob"}))
    save("profile_balances", get("/profileBalances", {"identifier": "jacob", "count": 3}))
    save("search", get("/search", {"text": "zora", "first": 5}))
    save("token_info", get("/tokenInfo", {"address": ZORA, "chainId": 8453}))
    save("coins", get("/coins", {"coins": [json.dumps({"chainId": 8453, "collectionAddress": coin}), json.dumps({"chainId": 8453, "collectionAddress": FAT_VANCE})]}))
    save("quote", post("/quote", {"tokenIn": {"type": "eth"}, "tokenOut": {"type": "erc20", "address": coin}, "amountIn": "1000000000000000",
                                 "sender": WALLET, "recipient": WALLET, "slippage": 0.05, "chainId": 8453}))


if __name__ == "__main__":
    main()
