import { createServerFn } from "@tanstack/solid-start";
import { getCookie } from "@tanstack/solid-start/server";
import { ConvexHttpClient } from "convex/browser";
import { getOAuthClient } from "~/auth/client";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";

const CONVEX_SERVER_SECRET = process.env.CONVEX_SERVER_SECRET;
if (!CONVEX_SERVER_SECRET) {
  throw new Error("CONVEX_SERVER_SECRET is not set");
}

function getConvexHttpClient(): ConvexHttpClient {
  const url = import.meta.env.VITE_CONVEX_URL;
  if (!url) {
    throw new Error("VITE_CONVEX_URL is not set");
  }
  return new ConvexHttpClient(url);
}

async function getAuthenticatedDid(): Promise<string> {
  const did = getCookie("did");
  if (!did) {
    throw new Error("Not authenticated");
  }

  const client = await getOAuthClient();
  const session = await client.restore(did);
  if (!session) {
    throw new Error("Session not found");
  }

  return did;
}

export const listHooks = createServerFn({ method: "GET" }).handler(async () => {
  const did = await getAuthenticatedDid();
  const convex = getConvexHttpClient();
  const hooks = await convex.query(api.hooks.listByUser, {
    serverSecret: CONVEX_SERVER_SECRET,
    userId: did,
  });
  return { did, hooks: hooks as Doc<"hooks">[] };
});

export interface GetHookResult {
  hook: Doc<"hooks">;
  events: Doc<"events">[];
}

export const getHookById = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => {
    if (
      typeof data !== "object" ||
      data === null ||
      !("hookId" in data) ||
      typeof data.hookId !== "string"
    ) {
      throw new Error("hookId is required");
    }
    return data as { hookId: string };
  })
  .handler(async (ctx): Promise<GetHookResult> => {
    const did = await getAuthenticatedDid();
    const convex = getConvexHttpClient();
    const hookIdTyped = ctx.data.hookId as Id<"hooks">;
    const hook = await convex.query(api.hooks.getById, {
      serverSecret: CONVEX_SERVER_SECRET,
      id: hookIdTyped,
    });
    if (!hook || hook.userId !== did) {
      throw new Error("Hook not found");
    }
    const events = await convex.query(api.events.getEventsForHook, {
      serverSecret: CONVEX_SERVER_SECRET,
      hookId: hookIdTyped,
      limit: 50,
    });
    return { hook, events: events as Doc<"events">[] };
  });
