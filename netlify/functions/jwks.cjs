exports.handler = async () => {
  if (!process.env.PRIVATE_KEY) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'PRIVATE_KEY is not set' }),
    }
  }

  const { JoseKey } = await import('@atproto/oauth-client-node')
  const key = await JoseKey.fromJWK(JSON.parse(process.env.PRIVATE_KEY))

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',
    },
    body: JSON.stringify({ keys: [key.publicJwk] }),
  }
}
