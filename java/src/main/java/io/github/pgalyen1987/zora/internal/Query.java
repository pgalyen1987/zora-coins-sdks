package io.github.pgalyen1987.zora.internal;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/** A query string being built, with repeated keys allowed. Internal. */
public final class Query {
    private final List<String[]> pairs = new ArrayList<>();

    /** Add one key/value. */
    public Query add(String key, String value) {
        pairs.add(new String[] {key, value});
        return this;
    }

    /** Format a parameter value the way the API expects. */
    public static String format(Object v) {
        if (v == null) return "";
        try {
            return (String) v.getClass().getMethod("value").invoke(v); // extensible enums
        } catch (ReflectiveOperationException e) {
            return String.valueOf(v);
        }
    }

    /** The encoded string, without the leading '?'. */
    public String encode() {
        StringBuilder sb = new StringBuilder();
        for (String[] p : pairs) {
            if (sb.length() > 0) sb.append('&');
            sb.append(enc(p[0])).append('=').append(enc(p[1]));
        }
        return sb.toString();
    }

    private static String enc(String s) {
        try {
            return URLEncoder.encode(s, StandardCharsets.UTF_8.name()).replace("+", "%20");
        } catch (java.io.UnsupportedEncodingException e) {
            throw new IllegalStateException(e);
        }
    }
}
