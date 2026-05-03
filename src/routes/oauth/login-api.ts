import { createFileRoute } from '@tanstack/solid-router'
import { getOAuthClient, SCOPE } from '~/auth/client'

export const Route = createFileRoute('/oauth/login-api')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json()
          let { handle } = body

          if (!handle || typeof handle !== 'string') {
            return new Response(JSON.stringify({ error: 'Handle is required' }), {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            })
          }

          const client = await getOAuthClient()
          const authUrl = await client.authorize(handle, {
            scope: SCOPE,
          })

          return new Response(JSON.stringify({ redirectUrl: authUrl.toString() }), {
            headers: { 'Content-Type': 'application/json' },
          })
        } catch (error) {
          console.error('OAuth login error:', error)
          return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : 'Login failed' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          )
        }
      },
    },
  },
})
