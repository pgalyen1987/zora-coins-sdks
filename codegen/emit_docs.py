"""Emit docs/ENDPOINTS.md: every endpoint and its method in each language, from the same model."""

from __future__ import annotations

from pathlib import Path

import docs
import ir as irmod
from emit_csharp import method_name as cs_method
from emit_java import jmethod
from emit_ts import camel

OUT = Path(__file__).resolve().parent.parent / "docs" / "ENDPOINTS.md"


def go_method(snake: str) -> str:
    from emit_go import go_name
    return go_name(snake)


def main() -> None:
    model = irmod.build()
    rows = []
    for op in model.operations:
        meta = docs.METHODS[op.id]
        s = meta["name"]
        paged = op.connection is not None
        it = lambda a, b: f"`{a}`<br>`{b}`" if paged else f"`{a}`"  # noqa: E731
        py_name = {"quote": "quote_trade"}.get(s, f"get_{s}" if not s.startswith(("explore", "search", "create")) else s)
        py = it(py_name, f"iter_{s}")
        rows.append("| " + " | ".join([
            f"`{op.method} {op.path}`",
            meta["doc"].split(". ")[0].rstrip(".") + ".",
            py,
            it(go_method(s), "Iter" + go_method(s)),
            it(s, f"iter_{s}"),
            it(camel(s), "iter" + camel(s)[:1].upper() + camel(s)[1:]),
            it(cs_method(s), cs_method(s, enumerate_=True)),
            it(jmethod(s), jmethod(s, iterate=True)),
            it(s, f"for_each_{s}"),
            f"`{camel(s)}`" + (" (mutation)" if op.id == "SetCreateUploadJWT" else ""),
        ]) + " |")
    text = f"""# Endpoints

All {len(model.operations)} Zora Coins API endpoints and the method that calls each one, in every SDK. Generated from
Zora's OpenAPI spec by `codegen/emit_docs.py`, so it can't drift from the code.

Paginated endpoints have two methods: one page, and a second that walks every page (an iterator,
stream or callback, depending on the language).

| Endpoint | What it returns | Python | Go | Rust | TypeScript | C# | Java | C++ | GraphQL |
|---|---|---|---|---|---|---|---|---|---|
""" + "\n".join(rows) + f"""

Plus, everywhere: `rewards` (what an address earned as a creator or referrer, read from Base — a
GraphQL query, and a module/package in each SDK), a GraphQL client, and helpers for the common cases:
`quote_trade` (defaults filled in), `coins_by_address`, `eth()` / `erc20(address)`.

## Types

{len(model.objects)} types and {len(model.enums)} enums, the same names in every language. The ones you'll use most:

| Type | What it is |
|---|---|
""" + "\n".join(f"| `{n}` | {docs.TYPES[n]} |" for n in ["Zora20Token", "Profile", "TokenBalance", "SwapActivity", "CoinBalance", "TradeActivity",
                                                             "SearchResult", "PricePoint", "PageInfo", "QuoteResponse", "Call"] if n in docs.TYPES) + """

### Units

The API returns every number that can be large as a string, and doesn't say what unit it's in. The SDKs' field docs do:

| Field | Unit |
|---|---|
| `Zora20Token.marketCap`, `volume24h`, `totalVolume`, `marketCapDelta24h` | USD, decimal string |
| `Zora20Token.totalSupply` | whole tokens, decimal string |
| `TokenBalance.balance`, `CoinBalance.balance`, `SwapActivity.coinAmount` | smallest unit, 18 decimals (divide by 10^18) |
| `TokenPrice.priceInUsdc`, `Currency.priceUsd` | USD per whole token, decimal string |
| `Call.value`, `QuoteRequest.amountIn` | smallest unit of the input token (wei for ETH) |
"""
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(text)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
