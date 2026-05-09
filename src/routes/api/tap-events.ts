import { createFileRoute } from '@tanstack/solid-router'
import { parseTapEvent, type TapEvent } from '@atproto/tap'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../../../convex/_generated/api'

const convex = new ConvexHttpClient(process.env.VITE_CONVEX_URL!)

export const Route = createFileRoute('/api/tap-events')({
  server: {
    handlers: {
      GET: async () => {
        console.log('get');
        return new Response(JSON.stringify({ status: 'ok' }), {
          headers: { 'Content-Type': 'application/json' },
        })
      },
      POST: async ({ request }) => {
        console.log('Received Tap event')
        try {
          const rawEvent = await request.json()
          
          // Get event type from raw event first
          const eventType = rawEvent?.type
          
          // Only process 'record' events
          if (eventType !== 'record') {
            return new Response(JSON.stringify({ ignored: true, type: eventType }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
          }

          // Try to parse for richer info, but fall back to raw
          let event:TapEvent | null = null
          try {
            event = parseTapEvent(rawEvent)
          } catch (parseErr) {
            console.log('parseTapEvent failed, using raw event:', parseErr?.message)
            event = null
          }

          // Get collection - parsed event only has it on record events
          const collection = event?.type === 'record' ? event.collection : rawEvent?.collection

          // Find all hooks and filter by collection
          const allHooks = await convex.query(api.hooks.listAll)
          const matchingHooks = (allHooks as any[]).filter(h => 
            h.nsid === collection && h.isActive
          )

          if (matchingHooks.length === 0) {
            return new Response(JSON.stringify({ matched: 0, delivered: 0 }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
          }
          console.log(`Matched ${matchingHooks.length} hooks for collection ${collection}`)

          // Deliver to each webhook - use RAW event, not parsed
          const deliveries = await Promise.allSettled(
            matchingHooks.map(async (hook: any) => {
              const startTime = Date.now()
              try {
                const response = await fetch(hook.webhookUrl, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'X-Community-Tap-Event': 'true',
                    'X-Community-Tap-Nsid': collection,
                  },
                  body: JSON.stringify(rawEvent), // Raw event to user
                })

                const duration = Date.now() - startTime
                return { 
                  hookId: hook._id, 
                  success: response.ok,
                  status: response.status,
                  duration,
                }
              } catch (error) {
                const duration = Date.now() - startTime
                return { 
                  hookId: hook._id, 
                  success: false,
                  error: error instanceof Error ? error.message : 'Unknown error',
                  duration,
                }
              }
            }),
          )

          const delivered = deliveries.filter(d => d.status === 'fulfilled' && d.value?.success).length
          const failed = deliveries.length - delivered

          return new Response(JSON.stringify({ matched: matchingHooks.length, delivered, failed }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        } catch (error) {
          console.error('Error handling tap event:', error)
          return new Response(JSON.stringify({ error: 'Internal server error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          })
        }
      },
    },
  },
})