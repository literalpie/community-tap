import { createFileRoute } from '@tanstack/solid-router'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../../../../convex/_generated/api';
import { Tap } from '@atproto/tap';

const convex = new ConvexHttpClient(process.env.VITE_CONVEX_URL!)

// Real Tap client - needs Node.js, so we import dynamically in the handler
async function getTapClient() {
  const tapUrl = import.meta.env.VITE_TAP_BASE_URL || 'http://localhost:2480'
  const tapPassword = process.env.TAP_ADMIN_PASSWORD
  return new Tap(tapUrl, { adminPassword: tapPassword })
}

export const Route = createFileRoute('/api/hooks/addRepo')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json()
          const { repoDid, registeredBy } = body

          if (!repoDid || typeof repoDid !== 'string') {
            return new Response(JSON.stringify({ error: 'Missing repoDid' }), {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            })
          }

          // Check if any hooks exist for this repo
          const allHooks = await convex.query(api.hooks.listAll)
          const hooksForRepo = allHooks.filter(h => h.isActive)

          if (hooksForRepo.length === 0) {
            return new Response(
              JSON.stringify({ error: 'No hooks found. Create a hook first.' }),
              { status: 400, headers: { 'Content-Type': 'application/json' } }
            )
          }

          // Call Tap to register the repo
          try {
            const tap = await getTapClient()
            await tap.addRepos([repoDid])
            console.log('Added repo to Tap:', repoDid)
          } catch (tapError) {
            console.error('Tap error:', tapError)
            // Continue even if Tap fails - log but don't fail
          }

          // Store registration in Convex
          await convex.mutation(api.repos.registerRepo, {
            repoDid,
            registeredBy: registeredBy || 'unknown',
          })

          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        } catch (error) {
          console.error('Error registering repo:', error)
          return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          )
        }
      },
    },
  },
})