package io.github.pgalyen1987.zora;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.time.Duration;
import java.util.Collections;
import java.util.List;
import java.util.Map;

/**
 * Sends HTTP requests. The default uses {@link HttpURLConnection}, which exists on every JVM and on
 * Android, so the SDK has no HTTP dependency. Implement this to use OkHttp or your own client.
 */
public interface Transport {
    /** An HTTP response. */
    final class Response {
        /** HTTP status. */
        public final int status;
        /** Response headers, keyed by lower-case name. */
        public final Map<String, List<String>> headers;
        /** Response body. */
        public final byte[] body;

        /** A response. */
        public Response(int status, Map<String, List<String>> headers, byte[] body) {
            this.status = status;
            this.headers = headers == null ? Collections.emptyMap() : headers;
            this.body = body == null ? new byte[0] : body;
        }

        /** The first value of a header, or null. */
        public String header(String name) {
            for (Map.Entry<String, List<String>> e : headers.entrySet()) {
                if (e.getKey() != null && e.getKey().equalsIgnoreCase(name) && !e.getValue().isEmpty()) return e.getValue().get(0);
            }
            return null;
        }
    }

    /** Send one request. {@code body} is null for GET. */
    Response send(String method, String url, Map<String, String> headers, byte[] body, Duration timeout) throws IOException;

    /** The default transport, on {@link HttpURLConnection}. */
    static Transport urlConnection() {
        return (method, url, headers, body, timeout) -> {
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setRequestMethod(method);
            int ms = (int) Math.min(Integer.MAX_VALUE, timeout.toMillis());
            c.setConnectTimeout(ms);
            c.setReadTimeout(ms);
            for (Map.Entry<String, String> h : headers.entrySet()) c.setRequestProperty(h.getKey(), h.getValue());
            if (body != null) {
                c.setDoOutput(true);
                try (OutputStream out = c.getOutputStream()) {
                    out.write(body);
                }
            }
            int status = c.getResponseCode();
            InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            if (in != null) {
                try (InputStream s = in) {
                    byte[] chunk = new byte[8192];
                    for (int n; (n = s.read(chunk)) > 0; ) buf.write(chunk, 0, n);
                }
            }
            return new Response(status, c.getHeaderFields(), buf.toByteArray());
        };
    }
}
