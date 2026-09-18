//! The HTTP client: configuration, retries, and pagination plumbing shared by every endpoint.

use std::collections::{HashSet, VecDeque};
use std::future::Future;
use std::time::Duration;

use futures_core::Stream;
use futures_util::stream;
use rand::Rng;
use serde::de::DeserializeOwned;

use crate::error::{Error, Result};

/// Zora's production REST API.
pub const DEFAULT_BASE_URL: &str = "https://api-sdk.zora.engineering";

/// Base mainnet, where Zora coins live. Every call defaults to it.
pub const BASE_CHAIN_ID: i64 = 8453;

const VERSION: &str = env!("CARGO_PKG_VERSION");

/// A client for the Zora Coins API. Cheap to clone (it shares one connection pool); create one
/// and reuse it.
///
/// Requests that hit a rate limit (429) or a server error (5xx) are retried with exponential
/// backoff, honouring `Retry-After`. Whatever still fails comes back as [`Error::Api`].
///
/// ```no_run
/// # async fn run() -> zora_coins::Result<()> {
/// let client = zora_coins::Client::new(); // reads ZORA_API_KEY if set
/// if let Some(coin) = client.coin("0x0b8590d3c0b1ee6c797e184a4afbb15f8f58a46b", None).await? {
///     println!("{:?} {:?}", coin.name, coin.market_cap);
/// }
/// # Ok(()) }
/// ```
#[derive(Clone, Debug)]
pub struct Client {
    pub(crate) http: reqwest::Client,
    pub(crate) base_url: String,
    pub(crate) api_key: Option<String>,
    pub(crate) user_agent: String,
    pub(crate) max_retries: u32,
}

impl Default for Client {
    fn default() -> Self {
        Self::new()
    }
}

impl Client {
    /// A client with default settings. Uses the `ZORA_API_KEY` environment variable if set.
    pub fn new() -> Self {
        Self::builder().build()
    }

    /// Configure a client: API key, base URL, retries, user agent, or your own `reqwest::Client`.
    pub fn builder() -> ClientBuilder {
        ClientBuilder::default()
    }

    /// Send one request and decode the JSON response. The generated methods are built on this;
    /// call it directly only for an endpoint the SDK doesn't wrap yet.
    pub async fn request<T: DeserializeOwned>(
        &self,
        method: &str,
        path: &str,
        query: &[(&str, String)],
        body: Option<serde_json::Value>,
    ) -> Result<T> {
        let url = format!("{}{}", self.base_url, path);
        let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| Error::Other(e.to_string()))?;
        let mut attempt = 0;
        loop {
            let mut req = self
                .http
                .request(method.clone(), &url)
                .query(query)
                .header("accept", "application/json")
                .header("user-agent", &self.user_agent);
            if let Some(key) = &self.api_key {
                req = req.header("api-key", key);
            }
            if let Some(b) = &body {
                req = req.json(b);
            }
            match req.send().await {
                Err(e) => {
                    if attempt >= self.max_retries || e.is_builder() {
                        return Err(Error::Http(e));
                    }
                    tokio::time::sleep(backoff(attempt, None)).await;
                }
                Ok(resp) => {
                    let status = resp.status();
                    if retryable(status.as_u16()) && attempt < self.max_retries {
                        let ra = resp.headers().get("retry-after").and_then(|v| v.to_str().ok()).map(str::to_owned);
                        tokio::time::sleep(backoff(attempt, ra.as_deref())).await;
                    } else {
                        let bytes = resp.bytes().await.map_err(Error::Http)?;
                        if status.as_u16() >= 400 {
                            return Err(Error::api(status.as_u16(), path, &bytes));
                        }
                        return serde_json::from_slice(&bytes).map_err(|source| Error::Decode { path: path.to_owned(), source });
                    }
                }
            }
            attempt += 1;
        }
    }
}

fn retryable(status: u16) -> bool {
    matches!(status, 429 | 500 | 502 | 503 | 504)
}

/// Exponential backoff with jitter, capped at 8s; `Retry-After` wins (capped at 30s).
fn backoff(attempt: u32, retry_after: Option<&str>) -> Duration {
    if let Some(secs) = retry_after.and_then(|s| s.trim().parse::<f64>().ok()) {
        return Duration::from_secs_f64(secs.clamp(0.0, 30.0));
    }
    let base = Duration::from_millis(500 * (1u64 << attempt.min(4)));
    base + Duration::from_millis(rand::thread_rng().gen_range(0..250))
}

/// Builder for [`Client`].
#[derive(Debug, Default)]
pub struct ClientBuilder {
    api_key: Option<String>,
    base_url: Option<String>,
    http: Option<reqwest::Client>,
    max_retries: Option<u32>,
    user_agent: Option<String>,
    timeout: Option<Duration>,
}

impl ClientBuilder {
    /// API key sent as the `api-key` header. Without one Zora's rate limits are much lower.
    /// Create one at <https://zora.co/settings/developer>.
    pub fn api_key(mut self, key: impl Into<String>) -> Self {
        self.api_key = Some(key.into());
        self
    }

    /// Point at another deployment (staging, a mock server in tests).
    pub fn base_url(mut self, url: impl Into<String>) -> Self {
        self.base_url = Some(url.into().trim_end_matches('/').to_owned());
        self
    }

    /// Use your own `reqwest::Client` (proxies, tracing, custom TLS).
    pub fn http_client(mut self, http: reqwest::Client) -> Self {
        self.http = Some(http);
        self
    }

    /// Retries for rate limits and server errors (default 3).
    pub fn max_retries(mut self, n: u32) -> Self {
        self.max_retries = Some(n);
        self
    }

    /// Prefix the User-Agent so Zora can tell your app's traffic apart.
    pub fn user_agent(mut self, ua: impl Into<String>) -> Self {
        self.user_agent = Some(ua.into());
        self
    }

    /// Per-request timeout (default 30s). Ignored when you pass your own `http_client`.
    pub fn timeout(mut self, t: Duration) -> Self {
        self.timeout = Some(t);
        self
    }

    /// Build the client.
    pub fn build(self) -> Client {
        let ua = match self.user_agent {
            Some(prefix) => format!("{prefix} zora-coins-rust/{VERSION}"),
            None => format!("zora-coins-rust/{VERSION}"),
        };
        let http = self.http.unwrap_or_else(|| {
            reqwest::Client::builder()
                .timeout(self.timeout.unwrap_or(Duration::from_secs(30)))
                .build()
                .expect("reqwest client")
        });
        Client {
            http,
            base_url: self.base_url.unwrap_or_else(|| DEFAULT_BASE_URL.to_owned()),
            api_key: self.api_key.or_else(|| std::env::var("ZORA_API_KEY").ok().filter(|k| !k.is_empty())),
            user_agent: ua,
            max_retries: self.max_retries.unwrap_or(3),
        }
    }
}

struct PageState<P, T, F> {
    params: P,
    buffer: VecDeque<T>,
    fetch: F,
    set_after: fn(&mut P, String),
    seen: HashSet<String>,
    done: bool,
}

/// Turns a page-at-a-time fetch into a stream of items. Stops after the last page, after an error,
/// or if the API hands back a cursor it already gave (which would otherwise loop forever).
pub(crate) fn paginate<'a, P, T, F, Fut>(params: P, fetch: F, set_after: fn(&mut P, String)) -> impl Stream<Item = Result<T>> + 'a
where
    P: Clone + 'a,
    T: 'a,
    F: Fn(P) -> Fut + 'a,
    Fut: Future<Output = Result<(Vec<T>, Option<String>)>> + 'a,
{
    let state = PageState { params, buffer: VecDeque::new(), fetch, set_after, seen: HashSet::new(), done: false };
    stream::unfold(state, |mut s| async move {
        loop {
            if let Some(item) = s.buffer.pop_front() {
                return Some((Ok(item), s));
            }
            if s.done {
                return None;
            }
            match (s.fetch)(s.params.clone()).await {
                Err(e) => {
                    s.done = true;
                    return Some((Err(e), s));
                }
                Ok((items, next)) => {
                    s.buffer.extend(items);
                    match next {
                        Some(c) if s.seen.insert(c.clone()) => (s.set_after)(&mut s.params, c),
                        _ => s.done = true,
                    }
                }
            }
        }
    })
}
