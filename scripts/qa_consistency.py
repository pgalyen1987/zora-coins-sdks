#!/usr/bin/env python3
"""QA: every method docs/ENDPOINTS.md names must be defined in that language's source."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PY = ROOT.parent / "zora-coins-py" / "src" / "zora_coins"

def read(*globs):
    return "\n".join(p.read_text() for g in globs for p in (ROOT.glob(g) if not str(g).startswith("/") else Path("/").glob(g[1:])))

sources = {
    "Python": (PY / "_client.py").read_text(),
    "Go": read("go/zora/*.go"),
    "Rust": read("rust/src/*.rs"),
    "TypeScript": read("typescript/src/*.ts"),
    "C#": read("dotnet/src/Zora.Coins/*.cs"),
    "Java": read("java/src/main/java/io/github/pgalyen1987/zora/*.java"),
    "C++": read("cpp/include/zora/*.inc", "cpp/include/zora/*.hpp"),
    "GraphQL": read("graphql/schema.graphql"),
}
patterns = {
    "Python": r"(?:async )?def {n}\(",
    "Go": r"func \(c \*Client\) {n}\(",
    "Rust": r"pub (?:async )?fn {n}[<(]",
    "TypeScript": r"(?:async )?{n}\(",
    "C#": r"(?:Task<.+>|IAsyncEnumerable<.+>|Task) {n}\(",
    "Java": r"public [\w<>, ]+ {n}\(",
    "C++": r"(?:void|[\w:<>, ]+) {n}\(",
    "GraphQL": r"^  {n}[(:]",
}
table = (ROOT / "docs" / "ENDPOINTS.md").read_text()
cols = ["Endpoint", "What", "Python", "Go", "Rust", "TypeScript", "C#", "Java", "C++", "GraphQL"]
missing, checked = [], 0
for line in table.splitlines():
    if not re.match(r"\| `(GET|POST) ", line):
        continue
    cells = [c.strip() for c in line.strip("|").split("|")]
    for lang, cell in zip(cols[2:], cells[2:]):
        for name in re.findall(r"`([A-Za-z_]\w*)`", cell):
            checked += 1
            if not re.search(patterns[lang].format(n=re.escape(name)), sources[lang], re.M):
                missing.append(f"{lang}: {name}  ({cells[0]})")
print(f"checked {checked} method names across 8 columns")
print("\n".join(missing) if missing else "every documented method exists")
