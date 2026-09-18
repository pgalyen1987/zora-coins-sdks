"""Turn Zora's OpenAPI spec into a language-neutral model (the "IR") that every emitter reads.

Zora's REST API is a thin layer over a GraphQL backend: each endpoint returns a different
*selection* of the same entities, and the spec writes every one of those selections out inline
(427 unnamed object schemas, up to 29 levels deep). Fed straight to a generator, that produces a
different type for every endpoint's view of a coin, with names like
``GetCoinCommentsResponseZora20Token``.

This module rebuilds the entities instead:

1. Every object is named after the field that holds it (``creatorProfile`` -> ``CreatorProfile``).
   Relay plumbing is named after the list it pages: the ``node`` inside ``tokenBalances`` is a
   ``TokenBalance``, its edge a ``TokenBalanceEdge``, the list a ``TokenBalanceConnection``.
2. Objects with the same name are merged into one type holding the union of their fields — the way
   the GraphQL type behind them looks. That is safe because every field is optional anyway.
3. If two same-named objects disagree about a field's type they are really different things, so the
   odd one out is split off under its parent's name (``SwapActivityCurrencyAmount``).
4. Structurally identical types left with different names are collapsed into one.

Every response field is optional. The live API omits fields its own spec marks required (V4 coins
have no ``uniswapV3PoolAddress``; ``zoraComments`` only appears when asked for), so strict types
would reject real responses — the Python SDK found 9 of 24 endpoints failing that way.
"""

from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

SPEC = Path(__file__).resolve().parent.parent / "spec" / "openapi.json"

# GraphQL's built-in scalar descriptions leak into Zora's spec on hundreds of fields. They say
# nothing about the field, so they are dropped rather than repeated in every language's docs.
_BOILERPLATE = re.compile(r"^The `(String|Boolean|Int|Float|ID)` scalar type", re.S)

# Where the field-name heuristic names an entity by the list that holds it, give it its real name.
# Every coin Zora returns (explore lists, a profile's coins, trends, search) is a Zora20Token.
ENTITY = {
    "ExploreList": "Zora20Token",
    "CreatedCoin": "Zora20Token",
    "TrendsByName": "Zora20Token",
    "TrendCoin": "Zora20Token",
    "GlobalSearch": "SearchResult",
    "ExploreTraderLeaderboard": "TraderLeaderboardEntry",
    "TraderLeaderboardFeaturedCreator": "FeaturedCreator",
    "WalletAddressTradeActivity": "TradeActivity",
    "LatestLiveStream": "LiveStream",
    "TopLiveStream": "LiveStream",
    "CoinsBasicInfo": "CoinBasicInfo",
    "Coin": "Zora20Token",
    "Trend": "Zora20Token",
    "CreatorCoin": "Zora20Token",
}
# Applied last, to whichever name survived deduplication.
FINAL = {
    "OneHour": "PricePoint",
    "TokenIn": "TokenSpec",
    "ExploreListConnection": "Zora20TokenConnection",
    "ExploreListEdge": "Zora20TokenEdge",
    "GlobalSearchConnection": "SearchResultConnection",
    "GlobalSearchEdge": "SearchResultEdge",
    "ExploreTraderLeaderboardConnection": "TraderLeaderboardEntryConnection",
    "ExploreTraderLeaderboardEdge": "TraderLeaderboardEntryEdge",
    "TraderLeaderboardFeaturedCreatorConnection": "FeaturedCreatorConnection",
    "TraderLeaderboardFeaturedCreatorEdge": "FeaturedCreatorEdge",
    "WalletAddressTradeActivityConnection": "TradeActivityConnection",
    "WalletAddressTradeActivityEdge": "TradeActivityEdge",
    "LatestLiveStreamConnection": "LiveStreamConnection",
    "LatestLiveStreamEdge": "LiveStreamEdge",
    "CoinsBasicInfoConnection": "CoinBasicInfoConnection",
    "CoinsBasicInfoEdge": "CoinBasicInfoEdge",
    "CreatedCoinConnection": "Zora20TokenConnection",
    "CreatedCoinEdge": "Zora20TokenEdge",
    "TrendsByNameConnection": "Zora20TokenConnection",
    "TrendsByNameEdge": "Zora20TokenEdge",
    "TokenInInput": "TokenSpecInput",
    "CoinInput": "CoinRefInput",
    "Zora20TokenInput": "CoinRefInput",  # /coins' {chainId, collectionAddress} items
    "TokenOutInput": "TokenSpecInput",
    "ContentCoinPoolConfig": "PoolConfig",
}
# Enums with identical values collapse into one; these pick the surviving name.
ENUM_FINAL = {
    "TokenInType": "TokenType",
    "TokenOutType": "TokenType",
    "ActivityType": "SwapType",
    "SwapActivityType": "SwapType",
    "PostCreateContentRequestCurrency": "ContentCoinCurrency",
    "CreateContentCoinRequestCurrency": "ContentCoinCurrency",
}
# List items named after something other than the singular of their list.
ITEM_NAMES = {"permits": "SignedPermit"}
# Zora's backend adds GraphQL's __typename to these objects although the spec leaves it out. It is
# the only way to tell a creator coin from a trend coin, or a profile hit from a coin hit.
TYPENAME = {
    "Zora20Token": "Which kind of coin this is: GraphQLZora20Token, GraphQLZora20V4Token, GraphQLZora20CreatorToken or GraphQLZora20TrendToken.",
    "SearchResult": "What was found: GlobalSearchCoinResult, GlobalSearchTrendResult or GlobalSearchUserProfileResult.",
    "Profile": "The profile kind, e.g. GraphQLAccountProfile.",
    "CreatorProfile": "The profile kind, e.g. GraphQLAccountProfile.",
    "OwnerProfile": "GraphQLAccountProfile for a Zora account, GraphQLWalletProfile for a bare wallet.",
    "TradeActivity": "The activity kind, e.g. GraphQLCoinSwapActivity.",
}
_GENERIC_ENUM = {"type", "kind", "status", "name", "currency"}


def pascal(s: str) -> str:
    s = re.sub(r"[^0-9a-zA-Z]+", " ", s)
    parts = re.findall(r"[A-Z]+(?![a-z])|[A-Z]?[a-z0-9]+|[A-Z]", s) or [s]
    return "".join(p[:1].upper() + p[1:] for p in parts)


def singular(word: str) -> str:
    if word.endswith("ies") and len(word) > 4:
        return word[:-3] + "y"
    if word.endswith(("sses", "shes", "ches", "xes")):
        return word[:-2]
    if word.endswith("s") and not word.endswith(("ss", "us", "is")):
        return word[:-1]
    return word


def clean_description(d: str | None) -> str | None:
    if not d:
        return None
    d = d.strip()
    if _BOILERPLATE.match(d):
        return None
    if d == "The Globally Unique ID of this object":
        return "Globally unique ID."
    return d


# ---- the model ---------------------------------------------------------------------------------


@dataclass(frozen=True)
class TypeRef:
    """A field's type: a scalar (string/int/float/bool), a named object/enum, a list, or raw JSON."""

    kind: str  # "scalar" | "object" | "enum" | "list" | "json"
    name: str = ""
    of: TypeRef | None = None
    format: str | None = None

    def key(self) -> str:
        if self.kind == "list":
            return "[" + (self.of.key() if self.of else "?") + "]"
        return f"{self.kind}:{self.name}"

    def to_json(self) -> dict:
        d: dict = {"kind": self.kind, "name": self.name}
        if self.of:
            d["of"] = self.of.to_json()
        if self.format:
            d["format"] = self.format
        return d


@dataclass
class Field:
    json: str
    type: TypeRef
    description: str | None = None
    required: bool = False  # request bodies only: responses are always optional
    default: object = None


@dataclass
class ObjectType:
    name: str
    fields: list[Field]
    description: str | None = None
    input: bool = False  # part of a request rather than a response
    seen_at: list[str] = field(default_factory=list)


@dataclass
class EnumType:
    name: str
    values: list[str]
    description: str | None = None


@dataclass
class Param:
    name: str
    type: TypeRef
    required: bool
    description: str | None = None
    default: object = None
    explode_list: bool = False  # array params repeat the key: chainIds=1&chainIds=2
    json_items: bool = False  # each list item is sent as a JSON object (only /coins does this)


@dataclass
class Operation:
    id: str  # operationId, e.g. GetCoinHolders
    method: str
    path: str
    params: list[Param]
    body: str | None
    response: str
    summary: str | None = None
    unwrap: str | None = None  # the single top-level field worth returning, e.g. zora20Token
    unwrap_type: str | None = None
    connection: list[str] | None = None  # JSON path to the Relay connection for paginated calls
    page_size_param: str | None = None  # "count" or "first"
    node_type: str | None = None


@dataclass
class IR:
    objects: dict[str, ObjectType]
    enums: dict[str, EnumType]
    operations: list[Operation]

    def op(self, op_id: str) -> Operation:
        return next(o for o in self.operations if o.id == op_id)

    def to_json(self) -> dict:
        def f(x: Field) -> dict:
            d = {"json": x.json, "type": x.type.to_json(), "description": x.description}
            if x.required:
                d["required"] = True
            if x.default is not None:
                d["default"] = x.default
            return d

        return {
            "objects": [{"name": o.name, "description": o.description, "input": o.input, "fields": [f(x) for x in o.fields]}
                        for o in self.objects.values()],
            "enums": [{"name": e.name, "values": e.values, "description": e.description} for e in self.enums.values()],
            "operations": [{
                "id": op.id, "method": op.method, "path": op.path, "summary": op.summary, "body": op.body,
                "response": op.response, "unwrap": op.unwrap, "unwrapType": op.unwrap_type, "connection": op.connection,
                "pageSizeParam": op.page_size_param, "nodeType": op.node_type,
                "params": [{"name": p.name, "type": p.type.to_json(), "required": p.required, "description": p.description,
                            "default": p.default, "explodeList": p.explode_list, "jsonItems": p.json_items} for p in op.params],
            } for op in self.operations],
        }


# ---- building it -------------------------------------------------------------------------------


def _is_connection(s: dict) -> bool:
    p = s.get("properties") or {}
    return s.get("type") == "object" and "edges" in p and "pageInfo" in p


@dataclass
class _Obj:
    schema: dict
    path: list[str]
    holder: str
    parent: int | None
    role: str  # "root" | "connection" | "edge" | "node" | "item" | "plain"
    input: bool
    children: dict[str, int] = field(default_factory=dict)  # field -> object occurrence (through lists)
    enums: dict[str, int] = field(default_factory=dict)  # field -> enum occurrence (through lists)


@dataclass
class _Enum:
    holder: str
    schema: dict
    parent: int | None


class _Builder:
    def __init__(self) -> None:
        self.objs: list[_Obj] = []
        self.enums: list[_Enum] = []
        self.name: list[str] = []
        self.enum_name: list[str] = []

    # -- pass 1: record every object and enum and where it sits ---------------------------------
    def visit(self, s: dict, path: list[str], holder: str, parent: int | None, role: str, is_input: bool) -> tuple[str, int] | None:
        if s.get("enum"):
            self.enums.append(_Enum(holder, s, parent))
            return ("enum", len(self.enums) - 1)
        t = s.get("type")
        if t == "array":
            return self.visit(s.get("items") or {}, path + ["[]"], holder, parent, "edge" if holder == "edges" else "item", is_input)
        if t != "object" or not s.get("properties"):
            return None
        idx = len(self.objs)
        self.objs.append(_Obj(s, path, holder, parent, "connection" if _is_connection(s) else role, is_input))
        for k, v in s["properties"].items():
            r = self.visit(v, path + [k], k, idx, "node" if k == "node" else "plain", is_input)
            if r and r[0] == "enum":
                self.objs[idx].enums[k] = r[1]
            elif r:
                self.objs[idx].children[k] = r[1]
        return ("obj", idx)

    def add_root(self, s: dict, name: str, is_input: bool) -> int:
        idx = len(self.objs)
        self.objs.append(_Obj(s, [], name, None, "root", is_input))
        for k, v in (s.get("properties") or {}).items():
            r = self.visit(v, [k], k, idx, "plain", is_input)
            if r and r[0] == "enum":
                self.objs[idx].enums[k] = r[1]
            elif r:
                self.objs[idx].children[k] = r[1]
        return idx

    # -- pass 2: names ---------------------------------------------------------------------------
    def _conn_holder(self, o: _Obj) -> str:
        segs = [p for p in o.path if p != "[]"]
        if o.holder == "node":
            return segs[-3] if len(segs) >= 3 else segs[0]
        if o.holder == "edges":
            return segs[-2] if len(segs) >= 2 else segs[0]
        return o.holder

    def base_name(self, o: _Obj) -> str:
        if o.role == "root":
            return o.holder
        if o.role == "connection":
            n = pascal(singular(o.holder))
            return ENTITY.get(n, n) + "Connection"
        if o.holder == "edges":
            n = pascal(singular(self._conn_holder(o)))
            return ENTITY.get(n, n) + "Edge"
        if o.holder == "node":
            n = pascal(singular(self._conn_holder(o)))
            return ENTITY.get(n, n)
        if o.holder == "pageInfo":
            return "PageInfo"
        if o.path and o.path[-1] == "[]" and o.holder in ITEM_NAMES:
            return ITEM_NAMES[o.holder]
        n = pascal(singular(o.holder) if o.path and o.path[-1] == "[]" else o.holder)
        return ENTITY.get(n, n)

    def _kind(self, i: int, k: str, s: dict) -> str:
        """How field k of occurrence i is typed, in terms of the current names."""
        if k in self.objs[i].enums:
            e = self.enum_name[self.objs[i].enums[k]] if self.enum_name else "enum"
            return ("[" if s.get("type") == "array" else "") + "enum:" + e
        if k in self.objs[i].children:
            inner = "obj:" + self.name[self.objs[i].children[k]]
            return "[" + inner + "]" if s.get("type") == "array" else inner
        if s.get("type") == "array":
            it = s.get("items") or {}
            return f"[{it.get('type')}]"
        if s.get("type") == "object":
            return "json"
        return f"s:{s.get('type')}"

    def name_objects(self) -> None:
        self.name = []
        for o in self.objs:
            n = self.base_name(o)
            self.name.append(n + "Input" if o.input and o.role != "root" and not n.endswith("Input") else n)
        # Split same-named occurrences that disagree about a field's type, until nothing changes.
        for _ in range(30):
            changed = False
            groups: dict[str, list[int]] = defaultdict(list)
            for i, o in enumerate(self.objs):
                if o.role != "root":
                    groups[self.name[i]].append(i)
            for name, members in groups.items():
                if len(members) < 2:
                    continue
                kinds: dict[str, Counter] = defaultdict(Counter)
                for i in members:
                    for k, v in self.objs[i].schema["properties"].items():
                        kinds[k][self._kind(i, k, v)] += 1
                for k, counts in kinds.items():
                    if len(counts) < 2:
                        continue
                    majority = counts.most_common(1)[0][0]
                    for i in members:
                        v = self.objs[i].schema["properties"].get(k)
                        if v is not None and self._kind(i, k, v) != majority:
                            p = self.objs[i].parent
                            prefix = self.name[p] if p is not None else ""
                            prefix = re.sub(r"^(Get|Post|Set)|Response$|Request$", "", prefix)
                            new = prefix + name if prefix and not name.startswith(prefix) else name + "2"
                            if new != self.name[i]:
                                self.name[i] = new
                                changed = True
                    if changed:
                        break
                if changed:
                    break
            if not changed:
                return
        raise RuntimeError("type naming did not converge")

    def name_enums(self) -> None:
        self.enum_name = []
        for e in self.enums:
            base = pascal(e.holder)
            if e.holder.lower() in _GENERIC_ENUM and e.parent is not None:
                base = re.sub(r"(Input)$", "", self.name[e.parent]) + pascal(e.holder)
            self.enum_name.append(base)

    # -- pass 3: materialise ---------------------------------------------------------------------
    def ref(self, s: dict, occ_obj: int | None = None, occ_enum: int | None = None) -> TypeRef:
        t = s.get("type")
        if s.get("enum"):
            return TypeRef("enum", self.enum_name[occ_enum] if occ_enum is not None else "?")
        if t == "array":
            return TypeRef("list", of=self.ref(s.get("items") or {}, occ_obj, occ_enum))
        if t == "object":
            if s.get("properties") and occ_obj is not None:
                return TypeRef("object", self.name[occ_obj])
            return TypeRef("json", "JSON")
        scalar = {"string": "string", "integer": "int", "number": "float", "boolean": "bool"}.get(t or "")
        return TypeRef("scalar", scalar, format=s.get("format")) if scalar else TypeRef("json", "JSON")

    def materialise(self) -> tuple[dict[str, ObjectType], dict[str, EnumType]]:
        enums: dict[str, EnumType] = {}
        for i, e in enumerate(self.enums):
            n = self.enum_name[i]
            vals = [str(v) for v in e.schema["enum"]]
            if n in enums:
                enums[n].values += [v for v in vals if v not in enums[n].values]
            else:
                enums[n] = EnumType(n, vals, clean_description(e.schema.get("description")))
        objects: dict[str, ObjectType] = {}
        for i, o in enumerate(self.objs):
            n = self.name[i]
            required = set(o.schema.get("required") or [])
            ot = objects.get(n)
            if ot is None:
                ot = objects[n] = ObjectType(n, [], clean_description(o.schema.get("description")), input=o.input)
            have = {f.json for f in ot.fields}
            for k, v in o.schema["properties"].items():
                if k in have:
                    f = next(f for f in ot.fields if f.json == k)
                    f.description = f.description or clean_description(v.get("description"))
                    continue
                ot.fields.append(Field(k, self.ref(v, o.children.get(k), o.enums.get(k)), clean_description(v.get("description")),
                                       required=o.input and k in required, default=v.get("default")))
            if len(ot.seen_at) < 3:
                ot.seen_at.append(".".join(o.path) or o.holder)
        return objects, enums


def _dedupe(objects: dict[str, ObjectType], roots: set[str]) -> dict[str, str]:
    """Collapse structurally identical types. Returns old name -> surviving name."""
    alias: dict[str, str] = {}

    def res(n: str) -> str:
        while n in alias:
            n = alias[n]
        return n

    def key(t: TypeRef) -> str:
        if t.kind == "list" and t.of:
            return "[" + key(t.of) + "]"
        if t.kind == "object":
            return "obj:" + res(t.name)
        return t.key()

    for _ in range(20):
        seen: dict[str, str] = {}
        changed = False
        for name, o in objects.items():
            if name in roots or name in alias:
                continue
            sig = ("in:" if o.input else "") + "|".join(sorted(f"{f.json}={key(f.type)}" for f in o.fields))
            if sig in seen:
                alias[name] = seen[sig]
                changed = True
            else:
                seen[sig] = name
        if not changed:
            break
    return {k: res(k) for k in alias}


def _rename(t: TypeRef, m: dict[str, str], em: dict[str, str] | None = None) -> TypeRef:
    if t.kind == "list" and t.of:
        return TypeRef("list", of=_rename(t.of, m, em))
    if t.kind == "object" and t.name in m:
        return TypeRef("object", m[t.name], format=t.format)
    if t.kind == "enum" and em and t.name in em:
        return TypeRef("enum", em[t.name])
    return t


def _dedupe_enums(enums: dict[str, EnumType]) -> dict[str, str]:
    """Enums with the same set of values become one. Returns old name -> surviving name."""
    by_values: dict[tuple, list[str]] = defaultdict(list)
    for n, e in enums.items():
        by_values[tuple(sorted(e.values))].append(n)
    out = {}
    for names in by_values.values():
        survivor = next((ENUM_FINAL[n] for n in names if n in ENUM_FINAL), sorted(names)[0])
        for n in names:
            out[n] = survivor
    return out


def _find_connection(schema: dict) -> list[str] | None:
    """Breadth-first: the shallowest Relay connection in a response (not one nested in a node)."""
    queue: list[tuple[dict, list[str]]] = [(schema, [])]
    while queue:
        s, p = queue.pop(0)
        if _is_connection(s):
            return p
        if s.get("type") == "object":
            for k, v in (s.get("properties") or {}).items():
                queue.append((v, p + [k]))
    return None


def build(spec_path: Path = SPEC) -> IR:
    spec = json.loads(spec_path.read_text())
    b = _Builder()
    raw_ops = []
    for path, methods in spec["paths"].items():
        for method, op in methods.items():
            op_id = op["operationId"][0].upper() + op["operationId"][1:]
            resp = op["responses"]["200"]["content"]["application/json"]["schema"]
            from docs import METHODS  # noqa: E402

            stem = pascal(METHODS[op_id]["name"])
            ri = b.add_root(resp, f"{stem}Response", False)
            bi = None
            if "requestBody" in op:
                bi = b.add_root(op["requestBody"]["content"]["application/json"]["schema"], f"{stem}Request", True)
            param_refs = {}
            for prm in op.get("parameters", []):
                s = prm["schema"]
                r = b.visit(s, [prm["name"]], singular(prm["name"]) if s.get("type") == "array" else prm["name"], None, "plain", True)
                param_refs[prm["name"]] = r
            raw_ops.append((path, method, op, op_id, resp, ri, bi, param_refs))

    b.name_objects()
    b.name_enums()
    objects, enums = b.materialise()
    enum_alias = _dedupe_enums(enums)
    enums = {enum_alias[n]: EnumType(enum_alias[n], e.values, e.description) for n, e in enums.items()}
    for o in objects.values():
        for f in o.fields:
            f.type = _rename(f.type, {}, enum_alias)
    roots = {b.name[ri] for *_, ri, _bi, _pr in raw_ops} | {b.name[bi] for *_, bi, _pr in raw_ops if bi is not None}
    alias = _dedupe(objects, roots)
    final = {}
    for name in objects:
        survivor = alias.get(name, name)
        final[name] = FINAL.get(survivor, survivor)
    merged: dict[str, ObjectType] = {}
    for name, o in objects.items():
        if name in alias:
            continue
        o.name = final[name]
        for f in o.fields:
            f.type = _rename(f.type, final)
        if o.name in merged:  # two survivors renamed onto the same entity: union their fields
            have = {f.json for f in merged[o.name].fields}
            merged[o.name].fields += [f for f in o.fields if f.json not in have]
        else:
            merged[o.name] = o

    operations = []
    for path, method, op, op_id, resp, ri, bi, param_refs in raw_ops:
        params = []
        for prm in op.get("parameters", []):
            s = prm["schema"]
            r = param_refs[prm["name"]]
            t = b.ref(s, r[1] if r and r[0] == "obj" else None, r[1] if r and r[0] == "enum" else None)
            t = _rename(t, final, enum_alias)
            params.append(Param(prm["name"], t, bool(prm.get("required")), clean_description(prm.get("description") or s.get("description")),
                                s.get("default"), explode_list=s.get("type") == "array",
                                json_items=s.get("type") == "array" and (s.get("items") or {}).get("type") == "object"))
        names = {p.name for p in params}
        conn = _find_connection(resp) if "after" in names else None
        node_type = None
        if conn:
            i = ri
            for k in conn:
                i = b.objs[i].children[k]
            edge = b.objs[i].children["edges"]
            node_type = final[b.name[b.objs[edge].children["node"]]] if "node" in b.objs[edge].children else None
        props = list((resp.get("properties") or {}).keys())
        unwrap = props[0] if len(props) == 1 else None
        unwrap_type = None
        if unwrap:
            ut = next(f.type for f in merged[final[b.name[ri]]].fields if f.json == unwrap)
            unwrap_type = ut.of.name if ut.kind == "list" and ut.of else ut.name
        operations.append(Operation(
            id=op_id, method=method.upper(), path=path, params=params,
            body=final[b.name[bi]] if bi is not None else None, response=final[b.name[ri]],
            summary=clean_description(op.get("summary") or op.get("description")),
            unwrap=unwrap, unwrap_type=unwrap_type, connection=conn, node_type=node_type,
            page_size_param=("count" if "count" in names else "first" if "first" in names else None) if conn else None,
        ))
    # Corrections the spec needs. Chain IDs are integers (the spec types some as float), and the
    # quote endpoint needs fields the spec doesn't mark required.
    from docs import REQUIRED_INPUT  # noqa: E402  (codegen/ is the import root)

    for name, o in merged.items():
        if o.input or name in roots or name == "PageInfo" or name.endswith(("Connection", "Edge")):
            continue
        if not any(f.json == "__typename" for f in o.fields):
            doc = TYPENAME.get(name, "The type name Zora's GraphQL backend reports for this object, when it includes one.")
            o.fields.insert(0, Field("__typename", TypeRef("scalar", "string"), doc))
    for f in merged["QuoteResponse"].fields:
        if f.json == "success":  # the API sends "true" (a string) where the spec says boolean
            f.type = TypeRef("scalar", "bool", format="lenient")
    for o in merged.values():
        for f in o.fields:
            if f.json == "chainId" and f.type.kind == "scalar" and f.type.name == "float":
                f.type = TypeRef("scalar", "int")
            if o.input and f.json in REQUIRED_INPUT.get(o.name, set()):
                f.required = True
    return IR(dict(sorted(merged.items())), dict(sorted(enums.items())), operations)


if __name__ == "__main__":
    ir = build()
    print(f"{len(ir.objects)} object types, {len(ir.enums)} enums, {len(ir.operations)} operations")
    for op in ir.operations:
        print(f"  {op.method:4} {op.path:28} -> {(op.unwrap_type or op.response):28} "
              f"{'paged ' + '.'.join(op.connection) + ' of ' + str(op.node_type) if op.connection else ''}")
