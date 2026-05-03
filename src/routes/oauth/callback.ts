import { createFileRoute } from '@tanstack/solid-router'
import { getOAuthClient } from '~/auth/client'
import { setCookie } from '@tanstack/solid-start/server'

export const Route = createFileRoute('/oauth/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url)
          console.log('[callback] request url:', url.toString())
          const params = url.searchParams
          const client = await getOAuthClient()

          const { session } = await client.callback(params)
          console.log('[callback] session created for did:', session.did)

          setCookie('did', session.did, {
            httpOnly: true,
            secure: import.meta.env.PROD,
            sameSite: 'lax',
            maxAge: 60 * 60 * 24 * 7,
            path: '/',
          })

          console.log('[callback] redirecting to /')
          return new Response(null, {
            status: 302,
            headers: {
              Location: '/',
            },
          })
        } catch (error) {
          console.error('[callback] error:', error)
          return new Response(null, {
            status: 302,
            headers: {
              Location: '/?error=login_failed',
            },
          })
        }
      },
    },
  },
})
