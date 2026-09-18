//! Conveniences on top of the generated endpoints.

use crate::client::BASE_CHAIN_ID;
use crate::error::Result;
use crate::models::{CoinRefInput, QuoteRequest, QuoteResponse, TokenSpecInput, TokenType, Zora20Token};
use crate::Client;

/// WETH on Base.
pub const WETH_ADDRESS: &str = "0x4200000000000000000000000000000000000006";
/// USDC on Base.
pub const USDC_ADDRESS: &str = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
/// The ZORA token on Base.
pub const ZORA_ADDRESS: &str = "0x1111111111166b7fe7bd91427724b487980afc69";

/// Native ETH as a trade input or output.
pub fn eth() -> TokenSpecInput {
    TokenSpecInput { r#type: TokenType::Eth, address: None }
}

/// An ERC-20 (a Zora coin, ZORA, USDC…) as a trade input or output.
pub fn erc20(address: impl Into<String>) -> TokenSpecInput {
    TokenSpecInput { r#type: TokenType::Erc20, address: Some(address.into()) }
}

impl Client {
    /// Several coins on Base by contract address, in one request.
    pub async fn coins_by_address<S: AsRef<str>>(&self, addresses: &[S]) -> Result<Vec<Zora20Token>> {
        let refs: Vec<CoinRefInput> = addresses
            .iter()
            .map(|a| CoinRefInput { chain_id: BASE_CHAIN_ID, collection_address: a.as_ref().to_lowercase() })
            .collect();
        self.coins(&refs).await
    }

    /// [`Client::quote`] with the usual defaults: the recipient is the sender, slippage 5%, chain
    /// Base. `amount_in` is in the input token's smallest unit (wei for ETH). Pass `extra` to set a
    /// referrer or override a default.
    ///
    /// ```no_run
    /// # async fn run(client: zora_coins::Client) -> zora_coins::Result<()> {
    /// use zora_coins::{eth, erc20};
    /// let q = client.quote_trade(eth(), erc20("0x0b85…"), "1000000000000000", "0xYourWallet", None).await?;
    /// let call = q.call.expect("a quote carries a call"); // target, data, value: give these to your wallet
    /// # Ok(()) }
    /// ```
    pub async fn quote_trade(
        &self,
        token_in: TokenSpecInput,
        token_out: TokenSpecInput,
        amount_in: impl Into<String>,
        sender: impl Into<String>,
        extra: Option<QuoteRequest>,
    ) -> Result<QuoteResponse> {
        let sender = sender.into();
        let mut req = extra.unwrap_or_default();
        req.token_in = token_in;
        req.token_out = token_out;
        req.amount_in = amount_in.into();
        req.recipient.get_or_insert_with(|| sender.clone());
        req.sender = sender;
        req.slippage.get_or_insert(0.05);
        req.chain_id.get_or_insert(BASE_CHAIN_ID);
        self.quote(&req).await
    }
}
