import { Agent } from "@atproto/api";
import { createServerFn } from "@tanstack/solid-start";
import { getCookie } from "@tanstack/solid-start/server";
import { ConvexHttpClient } from "convex/browser";
import { requireConvexServerSecret } from "~/lib/utils";
import { getOAuthClient } from "~/auth/client";
import { createHookRecord, deleteHookRecord, listHookRecords } from "~/lib/pds";
import { api } from "../../../convex/_generated/api";
import { getAuthenticatedDid } from "./-queries";

function getConvexHttpClient(): ConvexHttpClient {
  const url = import.meta.env.VITE_CONVEX_URL;
  if (!url) {
    throw new Error("VITE_CONVEX_URL is not set");
  }
  return new ConvexHttpClient(url);
}

async function getSessionAgent() {
  const did = getCookie("did");
  if (!did) {
    throw new Error("Not authenticated");
  }

  const client = await getOAuthClient();
  const session = await client.restore(did);
  if (!session) {
    throw new Error("Session not found");
  }

  const agent = new Agent(session.fetchHandler.bind(session));
  return { agent, did };
}

export const listHooksFromPDS = createServerFn({ method: "GET" }).handler(
  async () => {
    const { agent, did } = await getSessionAgent();
    const records = await listHookRecords(agent, did);
    return { did, records };
  },
);

export const createHookOnPDS = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (
      typeof data !== "object" ||
      data === null ||
      !("nsid" in data) ||
      !("webhookUrl" in data) ||
      typeof data.nsid !== "string" ||
      typeof data.webhookUrl !== "string"
    ) {
      throw new Error("Invalid input: nsid and webhookUrl are required");
    }
    return data as { nsid: string; webhookUrl: string };
  })
  .handler(async (ctx) => {
    const SERVICE_ID = process.env.COMMUNITY_TAP_SERVICE_ID;
    const CONVEX_SERVER_SECRET = requireConvexServerSecret();
    const data = ctx.data;
    const { agent, did } = await getSessionAgent();

    // Validate NSID format
    const nsidRegex = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/;
    if (!nsidRegex.test(data.nsid)) {
      throw new Error("Invalid NSID format");
    }

    // Check for duplicate in Convex
    const convex = getConvexHttpClient();
    const existingHooks = await convex.query(api.hooks.listByUser, {
      serverSecret: CONVEX_SERVER_SECRET,
      userId: did,
    });
    const duplicate = existingHooks.find((h) => h.nsid === data.nsid);
    if (duplicate) {
      throw new Error(
        "You already have a hook for this NSID. Delete it first to change the webhook URL.",
      );
    }

    // Write to PDS
    let pdsResult: { uri: string; cid: string };
    try {
      if (!SERVICE_ID) {
        throw new Error("Service ID is not configured");
      }
      pdsResult = await createHookRecord(agent, did, {
        nsid: data.nsid,
        webhookUrl: data.webhookUrl,
        serviceId: SERVICE_ID,
      });
    } catch (pdsErr) {
      throw new Error(
        pdsErr instanceof Error
          ? pdsErr.message
          : "Failed to write hook to PDS",
      );
    }

    // Write to Convex
    try {
      await convex.mutation(api.hooks.upsert, {
        serverSecret: CONVEX_SERVER_SECRET,
        userId: did,
        nsid: data.nsid,
        webhookUrl: data.webhookUrl,
        recordUri: pdsResult.uri,
        createdAt: Date.now(),
        isActive: true,
      });
    } catch (convexErr) {
      // Attempt PDS rollback
      console.error(
        "[createHook] Convex write failed, attempting PDS rollback:",
        convexErr,
      );
      try {
        await deleteHookRecord(agent, pdsResult.uri);
      } catch (rollbackErr) {
        console.error("[createHook] PDS rollback also failed:", rollbackErr);
      }
      throw new Error(
        "Failed to save hook to database. Please try again or use Sync to recover.",
      );
    }

    return { uri: pdsResult.uri, cid: pdsResult.cid };
  });

export const deleteHookOnPDS = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (
      typeof data !== "object" ||
      data === null ||
      !("uri" in data) ||
      typeof data.uri !== "string"
    ) {
      throw new Error("Invalid input: uri is required");
    }
    return data as { uri: string };
  })
  .handler(async (ctx) => {
    const CONVEX_SERVER_SECRET = requireConvexServerSecret();
    const data = ctx.data;
    const { agent } = await getSessionAgent();

    // Delete from PDS first
    try {
      await deleteHookRecord(agent, data.uri);
    } catch (pdsErr) {
      throw new Error(
        pdsErr instanceof Error
          ? pdsErr.message
          : "Failed to delete hook from PDS",
      );
    }

    // Delete from Convex
    try {
      const convex = getConvexHttpClient();
      await convex.mutation(api.hooks.deleteByRecordUri, {
        serverSecret: CONVEX_SERVER_SECRET,
        recordUri: data.uri,
      });
    } catch (convexErr) {
      console.error("[deleteHook] Convex delete failed:", convexErr);
      // Log warning — sync will clean it up
    }

    return { success: true };
  });

export const syncHooksFromPDS = createServerFn({ method: "POST" }).handler(
  async () => {
    const SERVICE_ID = process.env.COMMUNITY_TAP_SERVICE_ID;
    const CONVEX_SERVER_SECRET = requireConvexServerSecret();
    const { agent, did } = await getSessionAgent();
    const convex = getConvexHttpClient();

    // Get PDS records
    const pdsRecords = await listHookRecords(agent, did);
    const matchingRecords = pdsRecords.filter(
      (r) => r.value.serviceId === SERVICE_ID,
    );
    const pdsUris = new Set(matchingRecords.map((r) => r.uri));

    // Get Convex records
    const convexHooks = await convex.query(api.hooks.listByUser, {
      serverSecret: CONVEX_SERVER_SECRET,
      userId: did,
    });
    const convexUris = new Set(convexHooks.map((h) => h.recordUri));

    // In PDS but not Convex → upsert
    const upserts = matchingRecords
      .filter((record) => !convexUris.has(record.uri))
      .map((record) =>
        convex.mutation(api.hooks.upsert, {
          serverSecret: CONVEX_SERVER_SECRET,
          userId: did,
          nsid: record.value.nsid,
          webhookUrl: record.value.webhookUrl,
          recordUri: record.uri,
          createdAt: new Date(record.value.createdAt).getTime() || Date.now(),
          isActive: true,
        }),
      );
    const upsertResults = await Promise.allSettled(upserts);
    const added = upsertResults.filter((r) => r.status === "fulfilled").length;

    // In Convex but not PDS → delete
    const deletes = convexHooks
      .filter((hook) => !pdsUris.has(hook.recordUri))
      .map((hook) =>
        convex.mutation(api.hooks.deleteByRecordUri, {
          serverSecret: CONVEX_SERVER_SECRET,
          recordUri: hook.recordUri,
        }),
      );
    const deleteResults = await Promise.allSettled(deletes);
    const removed = deleteResults.filter(
      (r) => r.status === "fulfilled",
    ).length;

    return { added, removed };
  },
);

export const generateWebhookSigningSecret = createServerFn({ method: "POST" })
  .handler(async () => {
    const CONVEX_SERVER_SECRET = requireConvexServerSecret();
    const did = await getAuthenticatedDid();
    const convex = getConvexHttpClient();

    const secret = await convex.mutation(api.users.generateWebhookSigningSecret, {
      serverSecret: CONVEX_SERVER_SECRET,
      did,
    });

    return { secret };
  });

export const regenerateWebhookSigningSecret = createServerFn({ method: "POST" })
  .handler(async () => {
    const CONVEX_SERVER_SECRET = requireConvexServerSecret();
    const did = await getAuthenticatedDid();
    const convex = getConvexHttpClient();

    const secret = await convex.mutation(api.users.regenerateWebhookSigningSecret, {
      serverSecret: CONVEX_SERVER_SECRET,
      did,
    });

    return { secret };
  });
