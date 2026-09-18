package io.github.pgalyen1987.zora;

import io.github.pgalyen1987.zora.model.CoinRefInput;
import io.github.pgalyen1987.zora.model.QuoteRequest;
import io.github.pgalyen1987.zora.model.QuoteResponse;
import io.github.pgalyen1987.zora.model.TokenSpecInput;
import io.github.pgalyen1987.zora.model.TokenType;
import io.github.pgalyen1987.zora.model.Zora20Token;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Client for the Zora Coins API: one method per endpoint ({@code getCoin}, {@code getCoinHolders},
 * {@code explore}, …) and a lazy {@code iterate…} for every paginated one. Thread-safe; build one and reuse it.
 *
 * <pre>{@code
 * ZoraCoins zora = ZoraCoins.builder().build();              // reads ZORA_API_KEY
 * zora.getCoin("0x0b8590d3c0b1ee6c797e184a4afbb15f8f58a46b", null)
 *     .ifPresent(c -> System.out.println(c.getName() + " " + c.getMarketCap()));
 * for (Zora20Token coin : zora.iterateExplore(ListType.TOP_GAINERS, new ExploreParams().pageSize(20))) {
 *     System.out.println(coin.getSymbol());
 * }
 * }</pre>
 *
 * <p>Rate limits and server errors are retried with backoff, honouring Retry-After; what's left throws a
 * {@link ZoraApiException}. Lookups that find nothing return an empty Optional. Unofficial; not affiliated with Zora.
 */
public final class ZoraCoins extends GeneratedClient {
    /** WETH on Base. */
    public static final String WETH_ADDRESS = "0x4200000000000000000000000000000000000006";
    /** USDC on Base. */
    public static final String USDC_ADDRESS = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
    /** The ZORA token on Base. */
    public static final String ZORA_ADDRESS = "0x1111111111166b7fe7bd91427724b487980afc69";

    ZoraCoins(Builder b) {
        super(b);
    }

    /** Configure a client. */
    public static Builder builder() {
        return new Builder();
    }

    /** Native ETH as a trade input or output. */
    public static TokenSpecInput eth() {
        return new TokenSpecInput().setType(TokenType.ETH);
    }

    /** An ERC-20 (a Zora coin, ZORA, USDC…) as a trade input or output. */
    public static TokenSpecInput erc20(String address) {
        return new TokenSpecInput().setType(TokenType.ERC20).setAddress(address);
    }

    /** Several coins on Base by contract address, in one request. */
    public List<Zora20Token> getCoinsByAddress(String... addresses) {
        List<CoinRefInput> refs = new ArrayList<>();
        for (String a : addresses) refs.add(new CoinRefInput().setChainId(BASE_CHAIN_ID).setCollectionAddress(a.toLowerCase(Locale.ROOT)));
        return getCoins(refs);
    }

    /**
     * {@link #quote} with the usual defaults: the recipient is the sender, slippage 5%, chain Base.
     * {@code amountIn} is in the input token's smallest unit (wei for ETH). Nothing is signed or sent: give the
     * result's call (target, data, value) to your wallet. {@code referrer} earns the trade referral reward; may be null.
     */
    public QuoteResponse quoteTrade(TokenSpecInput tokenIn, TokenSpecInput tokenOut, String amountIn, String sender, String referrer) {
        return quote(new QuoteRequest().setTokenIn(tokenIn).setTokenOut(tokenOut).setAmountIn(amountIn).setSender(sender)
                .setRecipient(sender).setSlippage(0.05).setChainId(BASE_CHAIN_ID).setReferrer(referrer));
    }
}
