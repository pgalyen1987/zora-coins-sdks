//! Errors.

/// Everything that can go wrong talking to Zora (or a GraphQL gateway, or a Base RPC node).
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum Error {
    /// The API answered with an HTTP error after retries were used up.
    #[error("zora {path}: {status} {message}")]
    Api {
        /// HTTP status.
        status: u16,
        /// The API's error message, if it sent one.
        message: String,
        /// The endpoint, e.g. `/coin`.
        path: String,
        /// The API's machine-readable reason, where it gives one: `/quote` answers 422 with
        /// `LIQUIDITY` when the pool can't fill the trade, or `UNKNOWN`.
        error_type: Option<String>,
        /// The raw response body.
        body: String,
    },
    /// The request never got an answer (DNS, TLS, timeout, connection reset).
    #[error("zora: {0}")]
    Http(#[from] reqwest::Error),
    /// The response wasn't the JSON the SDK expected.
    #[error("zora: unexpected response from {path}: {source}")]
    Decode {
        /// The endpoint.
        path: String,
        /// What serde said.
        #[source]
        source: serde_json::Error,
    },
    /// A GraphQL gateway answered with errors.
    #[error("zora graphql: {}", .0.iter().map(|e| e.message.as_str()).collect::<Vec<_>>().join("; "))]
    GraphQL(Vec<crate::graphql::GraphQLError>),
    /// A JSON-RPC node refused a call (rewards indexer).
    #[error("rpc {method}: {code} {message}")]
    Rpc {
        /// The RPC method.
        method: String,
        /// JSON-RPC error code.
        code: i64,
        /// The node's message.
        message: String,
    },
    /// Anything else, e.g. an invalid address given to the rewards indexer.
    #[error("zora: {0}")]
    Other(String),
}

impl From<serde_json::Error> for Error {
    fn from(source: serde_json::Error) -> Self {
        Error::Decode { path: String::new(), source }
    }
}

impl Error {
    /// Whether Zora refused the request for exceeding its rate limit. An API key raises it.
    pub fn is_rate_limited(&self) -> bool {
        matches!(self, Error::Api { status: 429, .. })
    }

    /// Whether a quote failed because the pool can't fill a trade that size. Try a smaller amount.
    pub fn is_insufficient_liquidity(&self) -> bool {
        matches!(self, Error::Api { error_type: Some(t), .. } if t == "LIQUIDITY")
    }

    /// The HTTP status, for API errors.
    pub fn status(&self) -> Option<u16> {
        match self {
            Error::Api { status, .. } => Some(*status),
            _ => None,
        }
    }

    pub(crate) fn api(status: u16, path: &str, body: &[u8]) -> Self {
        let text = String::from_utf8_lossy(body).into_owned();
        let json = serde_json::from_slice::<serde_json::Value>(body).ok();
        let error_type = json.as_ref().and_then(|v| v.get("errorType")).and_then(|t| t.as_str()).map(str::to_owned);
        let message = json
            .and_then(|v| {
                v.get("message")
                    .and_then(|m| m.as_str())
                    .or_else(|| v.get("error").and_then(|e| e.as_str().or_else(|| e.get("message").and_then(|m| m.as_str()))))
                    .map(str::to_owned)
            })
            .unwrap_or_else(|| text.chars().take(300).collect());
        Error::Api { status, message, path: path.to_owned(), error_type, body: text }
    }
}

/// `Result<T, zora_coins::Error>`.
pub type Result<T, E = Error> = std::result::Result<T, E>;
