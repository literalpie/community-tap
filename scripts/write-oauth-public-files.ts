import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { JoseKey } from "@atproto/oauth-client-node";

const scope = "atproto repo:com.communitytap.hook";

function getPublicUrl() {
  const isProduction = process.env.CONTEXT === "production";
  const url = isProduction
    ? process.env.VITE_URL || process.env.URL
    : process.env.VITE_PUBLIC_URL || process.env.DEPLOY_PRIME_URL;

  return (
    process.env.PUBLIC_URL ||
    url ||
    process.env.VITE_URL ||
    process.env.URL ||
    "https://localhost:3000"
  ).replace(/\/+$/, "");
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

const publicUrl = getPublicUrl();

await writeJson(resolve("dist/oauth/client-metadata.json"), {
  client_id: `${publicUrl}/oauth/client-metadata.json`,
  client_name: "Community Tap",
  client_uri: publicUrl,
  redirect_uris: [`${publicUrl}/oauth/callback`],
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  scope,
  token_endpoint_auth_method: "private_key_jwt",
  token_endpoint_auth_signing_alg: "ES256",
  jwks_uri: `${publicUrl}/jwks.json`,
  dpop_bound_access_tokens: true,
});

if (!process.env.PRIVATE_KEY) {
  if (process.env.NETLIFY) {
    throw new Error("PRIVATE_KEY is required to generate dist/jwks.json");
  }

  await writeJson(resolve("dist/jwks.json"), { keys: [] });
  process.exit(0);
}

const key = await JoseKey.fromJWK(JSON.parse(process.env.PRIVATE_KEY));
await writeJson(resolve("dist/jwks.json"), { keys: [key.publicJwk] });
