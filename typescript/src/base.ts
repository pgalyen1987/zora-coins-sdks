/** Zora's production REST API. */
export const DEFAULT_BASE_URL = "https://api-sdk.zora.engineering";
/** Base mainnet, where Zora coins live. Every call defaults to it. */
export const BASE_CHAIN_ID = 8453;
/** SDK version, sent in the User-Agent header where the runtime allows it. */
export const VERSION = "0.1.1";

/** Options for {@link ZoraCoins} and {@link ZoraGraphQL}. */
export interface ClientOptions {
  /**
   * API key sent as the `api-key` header. Without one Zora's rate limits are much lower. Create one
   * at https://zora.co/settings/developer. Defaults to `process.env.ZORA_API_KEY` on Node.
   */
  apiKey?: string;
  /** Another deployment (staging, a mock server in tests). */
  baseUrl?: string;
  /** Retries for rate limits (429) and server errors (5xx). Default 3. */
  maxRetries?: number;
  /** Per-request timeout in milliseconds. Default 30000. */
  timeoutMs?: number;
  /** A `fetch` implementation, e.g. to add tracing. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Prefix for the User-Agent header, so Zora can tell your app's traffic apart. */
  userAgent?: string;
}

/** The Zora API answered with an HTTP error after retries were used up. */
export class ZoraApiError extends Error {
  /** HTTP status. */
  readonly status: number;
  /** The endpoint, e.g. `/coin`. */
  readonly path: string;
  /** The API's machine-readable reason, where it gives one: `/quote` answers 422 with `LIQUIDITY`. */
  readonly errorType: string | undefined;
  /** The response body (parsed JSON, or text). */
  readonly body: unknown;

  constructor(status: number, message: string, path: string, body: unknown) {
    super(`zora ${path}: ${status} ${message}`);
    this.name = "ZoraApiError";
    this.status = status;
    this.path = path;
    this.body = body;
    const t = (body as { errorType?: unknown } | null)?.errorType;
    this.errorType = typeof t === "string" ? t : undefined;
  }

  /** Whether Zora refused the request for exceeding its rate limit. An API key raises it. */
  get isRateLimited(): boolean {
    return this.status === 429;
  }

  /** Whether a quote failed because the pool can't fill a trade that size. Try a smaller amount. */
  get isInsufficientLiquidity(): boolean {
    return this.errorType === "LIQUIDITY";
  }
}

const RETRY = new Set([429, 500, 502, 503, 504]);

function envKey(): string | undefined {
  const p = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return p?.env?.ZORA_API_KEY || undefined;
}

function backoffMs(attempt: number, retryAfter: string | null): number {
  const s = retryAfter === null ? NaN : Number(retryAfter);
  if (!Number.isNaN(s) && s >= 0) return Math.min(s, 30) * 1000;
  return Math.min(2 ** attempt, 16) * 500 + Math.random() * 250;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(signal.reason);
    }, { once: true });
  });

/** HTTP plumbing shared by every endpoint: headers, retries with backoff, errors. */
export class BaseClient {
  protected readonly baseUrl: string;
  protected readonly key: string | undefined;
  protected readonly maxRetries: number;
  protected readonly timeoutMs: number;
  protected readonly fetchImpl: typeof fetch;
  protected readonly userAgent: string;

  constructor(options: ClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.key = options.apiKey ?? envKey();
    this.maxRetries = options.maxRetries ?? 3;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.userAgent = `${options.userAgent ? options.userAgent + " " : ""}zora-coins-ts/${VERSION}`;
  }

  /**
   * Send one request and parse the JSON response. The generated methods are built on this; call it
   * directly only for an endpoint the SDK doesn't wrap yet.
   */
  async request<T>(method: string, path: string, query: Array<[string, string]> = [], body?: unknown, signal?: AbortSignal): Promise<T> {
    const qs = query.length ? "?" + new URLSearchParams(query).toString() : "";
    const url = this.baseUrl + path + qs;
    const headers: Record<string, string> = { accept: "application/json", "user-agent": this.userAgent };
    if (this.key) headers["api-key"] = this.key;
    if (body !== undefined) headers["content-type"] = "application/json";
    for (let attempt = 0; ; attempt++) {
      const timeout = AbortSignal.timeout(this.timeoutMs);
      const sig = signal ? AbortSignal.any([signal, timeout]) : timeout;
      let resp: Response;
      try {
        resp = await this.fetchImpl(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: sig });
      } catch (err) {
        if (signal?.aborted || attempt >= this.maxRetries) throw err;
        await sleep(backoffMs(attempt, null), signal);
        continue;
      }
      if (RETRY.has(resp.status) && attempt < this.maxRetries) {
        await resp.body?.cancel();
        await sleep(backoffMs(attempt, resp.headers.get("retry-after")), signal);
        continue;
      }
      const text = await resp.text();
      let parsed: unknown = text;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        /* not JSON: keep the text */
      }
      if (resp.status >= 400) {
        const p = parsed as { message?: unknown; error?: unknown } | null;
        const msg = typeof p?.message === "string" ? p.message : typeof p?.error === "string" ? p.error : text.slice(0, 300) || resp.statusText;
        throw new ZoraApiError(resp.status, msg, path, parsed);
      }
      return parsed as T;
    }
  }
}

/**
 * Turns a page-at-a-time fetch into an async generator of items. Stops after the last page, or if
 * the API hands back a cursor it already gave (which would otherwise loop forever).
 */
export async function* paginate<P extends { after?: string }, T>(
  params: P,
  fetchPage: (p: P) => Promise<[T[], string | undefined]>,
): AsyncGenerator<T, void, undefined> {
  const seen = new Set<string>();
  let p = { ...params };
  for (;;) {
    const [items, next] = await fetchPage(p);
    yield* items;
    if (!next || seen.has(next)) return;
    seen.add(next);
    p = { ...p, after: next };
  }
}
