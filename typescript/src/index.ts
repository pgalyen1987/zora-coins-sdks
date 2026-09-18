/**
 * Typed client for the Zora Coins API — all 30 endpoints — plus a GraphQL client and (in
 * `zora-coins/rewards`) an onchain indexer for the creator and referral rewards Zora pays on Base.
 * Zero dependencies. Unofficial; not affiliated with Zora.
 *
 * ```ts
 * import { ZoraCoins, ListType } from "zora-coins";
 *
 * const zora = new ZoraCoins(); // reads ZORA_API_KEY on Node
 * const coin = await zora.coin("0x0b8590d3c0b1ee6c797e184a4afbb15f8f58a46b"); // null if none
 * for await (const c of zora.iterExplore(ListType.TopGainers, { pageSize: 20 })) {
 *   console.log(c.symbol, c.marketCapDelta24h);
 * }
 * ```
 *
 * Works alongside Zora's official `@zoralabs/coins-sdk`: same API, plus the rewards indexer, the
 * GraphQL client, and types shared with the Go, Rust and Python SDKs.
 * @module
 */
import { BASE_CHAIN_ID } from "./base.js";
import { GeneratedClient } from "./client.js";
import type { QuoteRequest, QuoteResponse, TokenSpecInput, Zora20Token, Zora20TokenConnection } from "./models.js";

export * from "./models.js";
export type * from "./client.js";
export { BASE_CHAIN_ID, DEFAULT_BASE_URL, VERSION, ZoraApiError, type ClientOptions } from "./base.js";
export { ZoraGraphQL, ZoraGraphQLError, type GraphQLErrorEntry } from "./graphql.js";

/** WETH on Base. */
export const WETH_ADDRESS = "0x4200000000000000000000000000000000000006";
/** USDC on Base. */
export const USDC_ADDRESS = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
/** The ZORA token on Base. */
export const ZORA_ADDRESS = "0x1111111111166b7fe7bd91427724b487980afc69";

/** Native ETH as a trade input or output. */
export const eth = (): TokenSpecInput => ({ type: "eth" });
/** An ERC-20 (a Zora coin, ZORA, USDC…) as a trade input or output. */
export const erc20 = (address: string): TokenSpecInput => ({ type: "erc20", address });

/** The items on one page of results, skipping empty edges. */
export function nodes<T>(page: { edges?: Array<{ node?: T | null } | null> | null } | null | undefined): T[] {
  return (page?.edges ?? []).flatMap((e) => (e?.node ? [e.node] : []));
}

/** The cursor for the next page, or undefined on the last page. */
export function nextCursor(page: { pageInfo?: { hasNextPage?: boolean | null; endCursor?: string | null } | null } | null | undefined): string | undefined {
  return page?.pageInfo?.hasNextPage ? (page.pageInfo.endCursor ?? undefined) : undefined;
}

/**
 * Client for the Zora Coins API: one method per endpoint (`coin`, `coinHolders`, `explore`, …), an
 * `iter…` async generator for every paginated one, and a few conveniences.
 *
 * Rate limits and server errors are retried with backoff, honouring `Retry-After`. What's left throws
 * a {@link ZoraApiError}. Lookups that find nothing resolve to `null`.
 */
export class ZoraCoins extends GeneratedClient {
  /** Several coins on Base by contract address, in one request. */
  coinsByAddress(...addresses: string[]): Promise<Zora20Token[]> {
    return this.coins(addresses.map((a) => ({ chainId: BASE_CHAIN_ID, collectionAddress: a.toLowerCase() })));
  }

  /**
   * {@link GeneratedClient.quote} with the usual defaults: the recipient is the sender, slippage 5%,
   * chain Base. `amountIn` is in the input token's smallest unit (wei for ETH). Nothing is signed or
   * sent: pass `result.call` (`target`, `data`, `value`) to your wallet.
   *
   * ```ts
   * const q = await zora.quoteTrade(eth(), erc20(coin), 10n ** 15n, wallet, { referrer: myApp });
   * await walletClient.sendTransaction({ to: q.call!.target, data: q.call!.data, value: BigInt(q.call!.value!) });
   * ```
   */
  quoteTrade(tokenIn: TokenSpecInput, tokenOut: TokenSpecInput, amountIn: bigint | string, sender: string, extra: Partial<QuoteRequest> = {}): Promise<QuoteResponse> {
    return this.quote({
      slippage: 0.05,
      chainId: BASE_CHAIN_ID,
      recipient: sender,
      ...extra,
      tokenIn,
      tokenOut,
      amountIn: String(amountIn),
      sender,
    });
  }

  /** Every coin on one Explore page, e.g. `zora.explorePage(ListType.New)` — shorthand for `nodes(await zora.explore(...))`. */
  async explorePage(...args: Parameters<GeneratedClient["explore"]>): Promise<Zora20Token[]> {
    return nodes((await this.explore(...args)) as Zora20TokenConnection);
  }
}
