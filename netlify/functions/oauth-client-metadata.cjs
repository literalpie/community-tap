const SCOPE = 'atproto repo:com.communitytap.hook'

function getPublicUrl() {
  const url =
    process.env.PUBLIC_URL ||
    process.env.URL ||
    process.env.VITE_URL ||
    process.env.DEPLOY_PRIME_URL ||
    process.env.DEPLOY_URL

  return (url || 'https://community-tap.netlify.app').replace(/\/+$/, '')
}

exports.handler = async () => {
  const publicUrl = getPublicUrl()

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',
    },
    body: JSON.stringify({
      client_id: `${publicUrl}/oauth/client-metadata.json`,
      client_name: 'Community Tap',
      client_uri: publicUrl,
      redirect_uris: [`${publicUrl}/oauth/callback`],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: SCOPE,
      token_endpoint_auth_method: 'private_key_jwt',
      token_endpoint_auth_signing_alg: 'ES256',
      jwks_uri: `${publicUrl}/jwks.json`,
      dpop_bound_access_tokens: true,
    }),
  }
}
