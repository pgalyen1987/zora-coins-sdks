//! Serde helpers for the places the live API disagrees with its spec.

use serde::{Deserialize, Deserializer};

/// A boolean the API may send as a string: `/quote` returns `"success": "true"` although its spec
/// says boolean. Accepts `true`, `false`, `"true"` and `"false"`.
pub(crate) fn flex_bool<'de, D: Deserializer<'de>>(d: D) -> Result<Option<bool>, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum B {
        Bool(bool),
        Str(String),
    }
    match Option::<B>::deserialize(d)? {
        None => Ok(None),
        Some(B::Bool(b)) => Ok(Some(b)),
        Some(B::Str(s)) => match s.as_str() {
            "true" => Ok(Some(true)),
            "false" => Ok(Some(false)),
            other => Err(serde::de::Error::custom(format!("{other:?} is not a boolean"))),
        },
    }
}
