import {
  buildAtprotoLoopbackClientMetadata,
  JoseKey,
  Keyset,
  NodeOAuthClient,
  type OAuthClientMetadataInput,
  requestLocalLock,
} from "@atproto/oauth-client-node";
import { ConvexClient } from "convex/browser";
import { getPublicUrl } from "~/lib/getPublicUrl";
import { api } from "../../convex/_generated/api";

let _convexClient: ConvexClient | null = null;

export function getConvexClient(): ConvexClient {
  if (!_convexClient) {
    const url = import.meta.env.VITE_CONVEX_URL;
    if (!url) {
      throw new Error("VITE_CONVEX_URL is not set");
    }
    _convexClient = new ConvexClient(url);
  }
  return _convexClient;
}

export const SCOPE = "atproto repo:com.communitytap.hook";

const PUBLIC_URL = getPublicUrl();
const PRIVATE_KEY = process.env.PRIVATE_KEY;

function getClientMetadata(): OAuthClientMetadataInput {
  console.log("has url", !!PUBLIC_URL, "has key", !!PRIVATE_KEY);
  if (PUBLIC_URL && PRIVATE_KEY) {
    return {
      client_id: `${PUBLIC_URL}/oauth/client-metadata.json`,
      client_name: "Community Tap",
      client_uri: PUBLIC_URL,
      redirect_uris: [`${PUBLIC_URL}/oauth/callback`],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: SCOPE,
      token_endpoint_auth_method: "private_key_jwt" as const,
      token_endpoint_auth_signing_alg: "ES256" as const,
      jwks_uri: `${PUBLIC_URL}/jwks.json`,
      dpop_bound_access_tokens: true,
    };
  }
  return buildAtprotoLoopbackClientMetadata({
    scope: SCOPE,
    redirect_uris: ["http://127.0.0.1:3000/oauth/callback"],
  });
}

async function getKeyset(): Promise<Keyset | undefined> {
  if (PUBLIC_URL && PRIVATE_KEY) {
    return new Keyset([await JoseKey.fromJWK(JSON.parse(PRIVATE_KEY))]);
  }
  return undefined;
}

export async function getOAuthClient(): Promise<NodeOAuthClient> {
  const convex = getConvexClient();
  return new NodeOAuthClient({
    clientMetadata: getClientMetadata(),
    keyset: await getKeyset(),
    requestLock: requestLocalLock,
    stateStore: {
      set: async (key, state) => {
        await convex.mutation(api.auth.setState, { key, state });
      },
      get: async (key) => {
        const result = await convex.query(api.auth.getState, { key });
        return result ? result.state : undefined;
      },
      del: async (key) => {
        await convex.mutation(api.auth.delState, { key });
      },
    },
    sessionStore: {
      set: async (sub, sessionData) => {
        await convex.mutation(api.auth.setSession, {
          did: sub,
          session: sessionData,
        });
      },
      get: async (sub) => {
        const result = await convex.query(api.auth.getSession, {
          did: sub,
        });
        return result ? result.session : undefined;
      },
      del: async (sub) => {
        await convex.mutation(api.auth.delSession, { did: sub });
      },
    },
  });
}
