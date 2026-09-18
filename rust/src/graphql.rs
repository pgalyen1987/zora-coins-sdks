//! A client for the zora-coins GraphQL gateway.

use serde::de::DeserializeOwned;
use serde::Deserialize;

use crate::error::{Error, Result};
use crate::Client;

/// Queries a zora-coins GraphQL gateway (`graphql/` in this repository): the whole Zora Coins API
/// as one schema, so a screen's worth of data is one request selecting exactly the fields it needs.
///
/// Results deserialize into the same types the REST client returns, because every field is
/// optional: a selection fills in the fields it asked for.
///
/// ```no_run
/// # async fn run() -> zora_coins::Result<()> {
/// use serde::Deserialize;
/// use zora_coins::{GraphQLClient, Zora20Token};
///
/// #[derive(Deserialize)]
/// struct Data { coin: Option<Zora20Token> }
///
/// let gql = GraphQLClient::new("http://localhost:8080/graphql");
/// let data: Data = gql
///     .query("query($a: String!) { coin(address: $a) { name symbol marketCap } }",
///            serde_json::json!({ "a": "0x0b8590d3c0b1ee6c797e184a4afbb15f8f58a46b" }))
///     .await?;
/// # Ok(()) }
/// ```
#[derive(Clone, Debug)]
pub struct GraphQLClient {
    client: Client,
}

/// One entry of a GraphQL response's `errors` array.
#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct GraphQLError {
    /// What went wrong.
    pub message: String,
    /// Where in the result, if the error belongs to a field.
    #[serde(default)]
    pub path: Vec<serde_json::Value>,
}

impl GraphQLClient {
    /// A client for the gateway at `endpoint`. Uses `ZORA_API_KEY` if set; the gateway forwards it.
    pub fn new(endpoint: impl Into<String>) -> Self {
        Self::with_client(Client::builder().base_url(endpoint).build())
    }

    /// Reuse a configured [`Client`] (API key, retries, HTTP client) whose base URL is the
    /// gateway's endpoint.
    pub fn with_client(client: Client) -> Self {
        Self { client }
    }

    /// Run a query and deserialize its `data`. If the gateway reports errors, they come back as
    /// [`Error::GraphQL`].
    pub async fn query<T: DeserializeOwned>(&self, query: &str, variables: serde_json::Value) -> Result<T> {
        #[derive(Deserialize)]
        struct Envelope {
            data: Option<serde_json::Value>,
            #[serde(default)]
            errors: Vec<GraphQLError>,
        }
        let body = serde_json::json!({ "query": query, "variables": variables });
        let env: Envelope = self.client.request("POST", "", &[], Some(body)).await?;
        if !env.errors.is_empty() {
            return Err(Error::GraphQL(env.errors));
        }
        serde_json::from_value(env.data.unwrap_or(serde_json::Value::Null)).map_err(Error::from)
    }
}
