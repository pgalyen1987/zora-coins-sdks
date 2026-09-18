package gateway

import _ "embed"

// SDL is the schema the gateway serves, as published at /schema.graphql.
//
//go:embed schema.graphql
var SDL []byte

// playground is GraphiQL, loaded from jsDelivr, with the api-key header wired to a field in the
// page so people can try the schema with their own key.
const playground = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Zora Coins GraphQL</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/graphiql@3.7.2/graphiql.min.css">
<style>html,body,#graphiql{height:100%;margin:0}body{font-family:system-ui,sans-serif}</style>
</head><body><div id="graphiql">Loading…</div>
<script src="https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/graphiql@3.7.2/graphiql.min.js"></script>
<script>
const fetcher = GraphiQL.createFetcher({ url: location.origin + "/graphql" });
const example = ` + "`" + `# The Zora Coins API as one GraphQL schema. Add your Zora API key under Headers:
#   { "api-key": "..." }
query Coin {
  coin(address: "0x0b8590d3c0b1ee6c797e184a4afbb15f8f58a46b") {
    name
    symbol
    marketCap
    uniqueHolders
    creatorProfile { handle }
  }
  explore(listType: TOP_GAINERS, pageSize: 5) {
    edges { node { symbol marketCapDelta24h } }
    pageInfo { endCursor hasNextPage }
  }
}
` + "`" + `;
ReactDOM.createRoot(document.getElementById("graphiql")).render(
  React.createElement(GraphiQL, { fetcher, defaultQuery: example, defaultEditorToolsVisibility: true }));
</script></body></html>`
