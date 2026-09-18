package io.github.pgalyen1987.zora;

/** The Zora API answered with an HTTP error after retries were used up. */
public final class ZoraApiException extends RuntimeException {
    private static final long serialVersionUID = 1L;
    private final int status;
    private final String path;
    private final String errorType;
    private final String body;

    ZoraApiException(int status, String message, String path, String errorType, String body) {
        super("zora " + path + ": " + status + " " + message);
        this.status = status;
        this.path = path;
        this.errorType = errorType;
        this.body = body;
    }

    /** HTTP status. */
    public int status() {
        return status;
    }

    /** The endpoint, e.g. {@code /coin}. */
    public String path() {
        return path;
    }

    /** The API's machine-readable reason, where it gives one: /quote answers 422 with {@code LIQUIDITY}. May be null. */
    public String errorType() {
        return errorType;
    }

    /** The raw response body. */
    public String body() {
        return body;
    }

    /** Whether Zora refused the request for exceeding its rate limit. An API key raises it. */
    public boolean isRateLimited() {
        return status == 429;
    }

    /** Whether a quote failed because the pool can't fill a trade that size. Try a smaller amount. */
    public boolean isInsufficientLiquidity() {
        return "LIQUIDITY".equals(errorType);
    }
}
