import { createServerFn } from '@tanstack/solid-start'
import { getCookie } from '@tanstack/solid-start/server'
import { getOAuthClient } from '~/auth/client'
import { ConvexHttpClient } from "convex/browser";
import { api } from '../../../convex/_generated/api';

function getConvexHttpClient(): ConvexHttpClient {
  const url = import.meta.env.VITE_CONVEX_URL;
  if (!url) {
    throw new Error("VITE_CONVEX_URL is not set");
  }
  return new ConvexHttpClient(url);
}

async function getAuthenticatedDid(): Promise<string> {
  const did = getCookie('did')
  if (!did) {
    throw new Error('Not authenticated')
  }

  const client = await getOAuthClient()
  const session = await client.restore(did)
  if (!session) {
    throw new Error('Session not found')
  }

  return did
}

export const listHooks = createServerFn({ method: 'GET' }).handler(async () => {
  const did = await getAuthenticatedDid()
  const convex = getConvexHttpClient()
  const hooks = await convex.query(api.hooks.listByUser, { userDid: did })
  return { did, hooks }
})
