package io.github.pgalyen1987.zora;

import com.fasterxml.jackson.databind.JsonNode;
import io.github.pgalyen1987.zora.internal.Json;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Client for the zora-coins GraphQL gateway: the whole Zora Coins API as one schema, so a screen's worth of data
 * is one request selecting exactly the fields it needs. Results convert into the same model classes as REST.
 *
 * <pre>{@code
 * ZoraGraphQL gql = new ZoraGraphQL("http://localhost:8080/graphql", null);
 * JsonNode data = gql.query("query($a: String!) { coin(address: $a) { name marketCap } }", Map.of("a", "0x…"));
 * Zora20Token coin = gql.convert(data.get("coin"), Zora20Token.class);
 * }</pre>
 */
public final class ZoraGraphQL {
    private final ZoraCoins client;

    /** A client for the gateway at {@code endpoint}. {@code apiKey} may be null (ZORA_API_KEY is read); the gateway forwards it. */
    public ZoraGraphQL(String endpoint, String apiKey) {
        this(endpoint, apiKey, null);
    }

    /** As {@link #ZoraGraphQL(String, String)}, with your own HTTP transport (null for the default). */
    public ZoraGraphQL(String endpoint, String apiKey, Transport transport) {
        this.client = ZoraCoins.builder().baseUrl(endpoint).apiKey(apiKey).transport(transport).build();
    }

    /** The gateway answered with GraphQL errors. */
    public static final class GraphQLException extends RuntimeException {
        private static final long serialVersionUID = 1L;
        private final transient List<String> messages;

        GraphQLException(List<String> messages) {
            super("zora graphql: " + String.join("; ", messages));
            this.messages = messages;
        }

        /** Each error's message. */
        public List<String> messages() {
            return messages;
        }
    }

    /** Run a query; returns its data as a JSON tree. Throws {@link GraphQLException} if the gateway reports errors. */
    public JsonNode query(String query, Map<String, Object> variables) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("query", query);
        body.put("variables", variables == null ? new LinkedHashMap<>() : variables);
        JsonNode resp = client.send("POST", "", null, body, JsonNode.class);
        JsonNode errors = resp == null ? null : resp.get("errors");
        if (errors != null && errors.isArray() && errors.size() > 0) {
            List<String> messages = new ArrayList<>();
            for (JsonNode e : errors) messages.add(e.path("message").asText());
            throw new GraphQLException(messages);
        }
        return resp == null ? null : resp.get("data");
    }

    /** Convert part of a result into a model class, e.g. {@code convert(data.get("coin"), Zora20Token.class)}. */
    public <T> T convert(JsonNode node, Class<T> type) {
        return node == null || node.isNull() ? null : Json.MAPPER.convertValue(node, type);
    }
}
