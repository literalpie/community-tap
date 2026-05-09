import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { JoseKey } from '@atproto/oauth-client-node'

const jwksPath = resolve('public/jwks.json')
const privateKey = process.env.PRIVATE_KEY

if (!privateKey) {
  if (process.env.NETLIFY) {
    throw new Error('PRIVATE_KEY is required to generate public/jwks.json')
  }

  await writeFile(jwksPath, `${JSON.stringify({ keys: [] }, null, 2)}\n`)
  process.exit(0)
}

const key = await JoseKey.fromJWK(JSON.parse(privateKey))

await mkdir(dirname(jwksPath), { recursive: true })
await writeFile(
  jwksPath,
  `${JSON.stringify({ keys: [key.publicJwk] }, null, 2)}\n`,
)
