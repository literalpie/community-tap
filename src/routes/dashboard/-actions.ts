import { createServerFn } from '@tanstack/solid-start'
import { getCookie } from '@tanstack/solid-start/server'
import { getOAuthClient } from '~/auth/client'
import { Agent } from '@atproto/api'
import {
  createHookRecord,
  deleteHookRecord,
  listHookRecords,
} from '~/lib/pds'
import { ConvexHttpClient } from "convex/browser";
import { api } from '../../../convex/_generated/api';

const SERVICE_ID = process.env.COMMUNITY_TAP_SERVICE_ID;

function getConvexHttpClient(): ConvexHttpClient {
  const url = import.meta.env.VITE_CONVEX_URL;
  if (!url) {
    throw new Error("VITE_CONVEX_URL is not set");
  }
  return new ConvexHttpClient(url);
}

async function getSessionAgent() {
  const did = getCookie('did')
  if (!did) {
    throw new Error('Not authenticated')
  }

  const client = await getOAuthClient()
  const session = await client.restore(did)
  if (!session) {
    throw new Error('Session not found')
  }

  const agent = new Agent(session.fetchHandler.bind(session))
  return { agent, did }
}

export const listHooksFromPDS = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { agent, did } = await getSessionAgent()
    const records = await listHookRecords(agent, did)
    return { did, records }
  }
)

export const createHookOnPDS = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => {
    if (
      typeof data !== 'object' ||
      data === null ||
      !('nsid' in data) ||
      !('webhookUrl' in data) ||
      typeof (data as any).nsid !== 'string' ||
      typeof (data as any).webhookUrl !== 'string'
    ) {
      throw new Error('Invalid input: nsid and webhookUrl are required')
    }
    return data as { nsid: string; webhookUrl: string }
  })
  .handler(async (ctx) => {
    const data = ctx.data
    const { agent, did } = await getSessionAgent()

    // Validate NSID format
    const nsidRegex = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/
    if (!nsidRegex.test(data.nsid)) {
      throw new Error('Invalid NSID format')
    }

    // Check for duplicate in Convex
    const convex = getConvexHttpClient()
    const existingHooks = await convex.query(api.hooks.listByUser, { userDid: did })
    const duplicate = existingHooks.find((h: any) => h.nsid === data.nsid)
    if (duplicate) {
      throw new Error(
        'You already have a hook for this NSID. Delete it first to change the webhook URL.'
      )
    }

    // Write to PDS
    let pdsResult: { uri: string; cid: string }
    try {
      if(!SERVICE_ID) {
        throw new Error('Service ID is not configured')
      }
      pdsResult = await createHookRecord(agent, did, {
        nsid: data.nsid,
        webhookUrl: data.webhookUrl,
        serviceId: SERVICE_ID,
      })
    } catch (pdsErr) {
      throw new Error(
        pdsErr instanceof Error ? pdsErr.message : 'Failed to write hook to PDS'
      )
    }

    // Write to Convex
    try {
      await convex.mutation(api.hooks.upsert, {
        userDid: did,
        nsid: data.nsid,
        webhookUrl: data.webhookUrl,
        pdsUri: pdsResult.uri,
        createdAt: Date.now(),
        enabled: true,
      })
    } catch (convexErr) {
      // Attempt PDS rollback
      console.error('[createHook] Convex write failed, attempting PDS rollback:', convexErr)
      try {
        await deleteHookRecord(agent, pdsResult.uri)
      } catch (rollbackErr) {
        console.error('[createHook] PDS rollback also failed:', rollbackErr)
      }
      throw new Error(
        'Failed to save hook to database. Please try again or use Sync to recover.'
      )
    }

    return { uri: pdsResult.uri, cid: pdsResult.cid }
  })

export const deleteHookOnPDS = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => {
    if (
      typeof data !== 'object' ||
      data === null ||
      !('uri' in data) ||
      typeof (data as any).uri !== 'string'
    ) {
      throw new Error('Invalid input: uri is required')
    }
    return data as { uri: string }
  })
  .handler(async (ctx) => {
    const data = ctx.data
    const { agent } = await getSessionAgent()

    // Delete from PDS first
    try {
      await deleteHookRecord(agent, data.uri)
    } catch (pdsErr) {
      throw new Error(
        pdsErr instanceof Error ? pdsErr.message : 'Failed to delete hook from PDS'
      )
    }

    // Delete from Convex
    try {
      const convex = getConvexHttpClient()
      await convex.mutation(api.hooks.deleteByUri, { pdsUri: data.uri })
    } catch (convexErr) {
      console.error('[deleteHook] Convex delete failed:', convexErr)
      // Log warning — sync will clean it up
    }

    return { success: true }
  })

export const syncHooksFromPDS = createServerFn({ method: 'POST' }).handler(
  async () => {
    const { agent, did } = await getSessionAgent()
    const convex = getConvexHttpClient()

    // Get PDS records
    const pdsRecords = await listHookRecords(agent, did)
    const matchingRecords = pdsRecords.filter((r) => r.value.serviceId === SERVICE_ID)
    const pdsUris = new Set(matchingRecords.map((r) => r.uri))

    // Get Convex records
    const convexHooks = await convex.query(api.hooks.listByUser, { userDid: did })
    const convexUris = new Set(convexHooks.map((h: any) => h.pdsUri))

    let added = 0
    let removed = 0

    // In PDS but not Convex → upsert
    for (const record of matchingRecords) {
      if (!convexUris.has(record.uri)) {
        await convex.mutation(api.hooks.upsert, {
          userDid: did,
          nsid: record.value.nsid,
          webhookUrl: record.value.webhookUrl,
          pdsUri: record.uri,
          createdAt: new Date(record.value.createdAt).getTime() || Date.now(),
          enabled: true,
        })
        added++
      }
    }

    // In Convex but not PDS → delete
    for (const hook of convexHooks) {
      if (!pdsUris.has(hook.pdsUri)) {
        await convex.mutation(api.hooks.deleteByUri, { pdsUri: hook.pdsUri })
        removed++
      }
    }

    return { added, removed }
  }
)
