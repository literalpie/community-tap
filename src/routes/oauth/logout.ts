import { createFileRoute } from '@tanstack/solid-router'
import { getOAuthClient } from '~/auth/client'
import { getCookie, deleteCookie } from '@tanstack/solid-start/server'

export const Route = createFileRoute('/oauth/logout')({
  server: {
    handlers: {
      POST: async () => {
        try {
          const did = getCookie('did')
          
          if (did) {
            const client = await getOAuthClient()
            await client.revoke(did)
          }

          deleteCookie('did')

          return new Response(null, {
            status: 302,
            headers: {
              Location: '/',
            },
          })
        } catch (error) {
          console.error('Logout error:', error)
          return new Response(null, {
            status: 302,
            headers: {
              Location: '/',
            },
          })
        }
      },
    },
  },
})
