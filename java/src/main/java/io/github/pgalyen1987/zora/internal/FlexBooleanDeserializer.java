package io.github.pgalyen1987.zora.internal;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonToken;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.JsonDeserializer;
import java.io.IOException;

/** A boolean the API may send as a string: /quote returns "success": "true". Internal. */
public final class FlexBooleanDeserializer extends JsonDeserializer<Boolean> {
    @Override
    public Boolean deserialize(JsonParser p, DeserializationContext ctx) throws IOException {
        JsonToken t = p.currentToken();
        if (t == JsonToken.VALUE_TRUE) return true;
        if (t == JsonToken.VALUE_FALSE) return false;
        if (t == JsonToken.VALUE_STRING) {
            String s = p.getText();
            if ("true".equals(s)) return true;
            if ("false".equals(s)) return false;
        }
        return (Boolean) ctx.handleUnexpectedToken(Boolean.class, p);
    }
}
