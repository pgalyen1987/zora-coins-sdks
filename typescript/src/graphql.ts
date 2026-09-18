import { BaseClient, type ClientOptions } from "./base.js";

/** One entry of a GraphQL response's `errors` array. */
export interface GraphQLErrorEntry {
  message: string;
  path?: Array<string | number>;
}

/** The gateway answered with GraphQL errors. `data` holds whatever did resolve. */
export class ZoraGraphQLError extends Error {
  readonly errors: GraphQLErrorEntry[];
  readonly data: unknown;
  constructor(errors: GraphQLErrorEntry[], data: unknown) {
    super("zora graphql: " + errors.map((e) => e.message).join("; "));
    this.name = "ZoraGraphQLError";
    this.errors = errors;
    this.data = data;
  }
}

/**
 * Client for the zora-coins GraphQL gateway: the whole Zora Coins API as one schema, so a screen's
 * worth of data is one request selecting exactly the fields it needs. Results use the same types as
 * the REST client.
 *
 * ```ts
 * const gql = new ZoraGraphQL("http://localhost:8080/graphql");
 * const { coin } = await gql.query<{ coin: Zora20Token | null }>(
 *   `query($a: String!) { coin(address: $a) { name symbol marketCap } }`, { a: "0x…" });
 * ```
 *
 * The gateway forwards your API key to Zora and keeps nothing.
 */
export class ZoraGraphQL extends BaseClient {
  constructor(endpoint: string, options: Omit<ClientOptions, "baseUrl"> = {}) {
    super({ ...options, baseUrl: endpoint });
  }

  /** Run a query and return its `data`. Throws {@link ZoraGraphQLError} if the gateway reports errors. */
  async query<T = Record<string, unknown>>(query: string, variables: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
    const res = await this.request<{ data?: T | null; errors?: GraphQLErrorEntry[] }>("POST", "", [], { query, variables }, signal);
    if (res?.errors?.length) throw new ZoraGraphQLError(res.errors, res.data);
    return (res?.data ?? {}) as T;
  }
}
