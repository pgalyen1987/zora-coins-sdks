package io.github.pgalyen1987.zora;

import com.fasterxml.jackson.databind.JsonNode;
import io.github.pgalyen1987.zora.internal.Json;
import io.github.pgalyen1987.zora.internal.Query;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ThreadLocalRandom;

/** HTTP plumbing shared by every endpoint: headers, retries with backoff, errors. */
public abstract class BaseClient {
    /** Zora's production REST API. */
    public static final String DEFAULT_BASE_URL = "https://api-sdk.zora.engineering";
    /** Base mainnet, where Zora coins live. Every call defaults to it. */
    public static final long BASE_CHAIN_ID = 8453L;
    /** SDK version, sent in the User-Agent header. */
    public static final String VERSION = "0.1.0";

    private final String baseUrl;
    private final String apiKey;
    private final int maxRetries;
    private final Duration timeout;
    private final Transport transport;
    private final String userAgent;

    BaseClient(Builder b) {
        this.baseUrl = b.baseUrl.replaceAll("/+$", "");
        this.apiKey = b.apiKey != null ? b.apiKey : System.getenv("ZORA_API_KEY");
        this.maxRetries = b.maxRetries;
        this.timeout = b.timeout;
        this.transport = b.transport != null ? b.transport : Transport.urlConnection();
        this.userAgent = (b.userAgent == null ? "" : b.userAgent + " ") + "zora-coins-java/" + VERSION;
    }

    /** Configures a {@link ZoraCoins} client. */
    public static final class Builder {
        private String baseUrl = DEFAULT_BASE_URL;
        private String apiKey;
        private int maxRetries = 3;
        private Duration timeout = Duration.ofSeconds(30);
        private Transport transport;
        private String userAgent;

        Builder() {}

        /** API key sent as the api-key header (default: the ZORA_API_KEY environment variable). Create one at https://zora.co/settings/developer. */
        public Builder apiKey(String apiKey) {
            this.apiKey = apiKey;
            return this;
        }

        /** Another deployment (staging, a mock server in tests). */
        public Builder baseUrl(String baseUrl) {
            this.baseUrl = baseUrl;
            return this;
        }

        /** Retries for rate limits (429) and server errors (5xx). Default 3. */
        public Builder maxRetries(int maxRetries) {
            this.maxRetries = maxRetries;
            return this;
        }

        /** Per-request timeout. Default 30 seconds. */
        public Builder timeout(Duration timeout) {
            this.timeout = timeout;
            return this;
        }

        /** Your own HTTP transport, e.g. OkHttp on Android. */
        public Builder transport(Transport transport) {
            this.transport = transport;
            return this;
        }

        /** Prefix for the User-Agent header, so Zora can tell your app's traffic apart. */
        public Builder userAgent(String userAgent) {
            this.userAgent = userAgent;
            return this;
        }

        /** Build the client. */
        public ZoraCoins build() {
            return new ZoraCoins(this);
        }

        String baseUrl() {
            return baseUrl;
        }
    }

    /**
     * Send one request and deserialize the JSON response. The generated methods are built on this; call it
     * directly only for an endpoint the SDK doesn't wrap yet.
     */
    public <T> T send(String method, String path, Query query, Object body, Class<T> type) {
        String qs = query == null ? "" : query.encode();
        String url = baseUrl + path + (qs.isEmpty() ? "" : "?" + qs);
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Accept", "application/json");
        headers.put("User-Agent", userAgent);
        if (apiKey != null && !apiKey.isEmpty()) headers.put("api-key", apiKey);
        byte[] payload = null;
        if (body != null) {
            headers.put("Content-Type", "application/json");
            payload = Json.write(body).getBytes(StandardCharsets.UTF_8);
        }
        for (int attempt = 0; ; attempt++) {
            Transport.Response resp;
            try {
                resp = transport.send(method, url, headers, payload, timeout);
            } catch (IOException e) {
                if (attempt >= maxRetries) throw new UncheckedIOException("zora " + method + " " + path, e);
                sleep(backoff(attempt, null));
                continue;
            }
            if ((resp.status == 429 || resp.status == 500 || resp.status == 502 || resp.status == 503 || resp.status == 504) && attempt < maxRetries) {
                sleep(backoff(attempt, resp.header("Retry-After")));
                continue;
            }
            if (resp.status >= 400) throw apiError(resp, path);
            return resp.body.length == 0 ? null : Json.read(resp.body, type);
        }
    }

    private static long backoff(int attempt, String retryAfter) {
        if (retryAfter != null) {
            try {
                return (long) (Math.min(Double.parseDouble(retryAfter.trim()), 30) * 1000);
            } catch (NumberFormatException ignored) {
                // an HTTP date: fall through to the exponential backoff
            }
        }
        return Math.min(1L << attempt, 16) * 500 + ThreadLocalRandom.current().nextInt(250);
    }

    private static void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("interrupted while backing off", e);
        }
    }

    private static ZoraApiException apiError(Transport.Response resp, String path) {
        String text = new String(resp.body, StandardCharsets.UTF_8);
        String message = "HTTP " + resp.status;
        String errorType = null;
        try {
            JsonNode n = Json.MAPPER.readTree(text);
            if (n != null && n.path("message").isTextual()) message = n.get("message").asText();
            else if (n != null && n.path("error").isTextual()) message = n.get("error").asText();
            if (n != null && n.path("errorType").isTextual()) errorType = n.get("errorType").asText();
        } catch (IOException e) {
            if (!text.isEmpty()) message = text.length() > 300 ? text.substring(0, 300) : text;
        }
        return new ZoraApiException(resp.status, message, path, errorType, text);
    }
}
