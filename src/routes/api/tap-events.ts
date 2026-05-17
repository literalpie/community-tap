import { assureAdminAuth, parseTapEvent, type TapEvent } from "@atproto/tap";
import { createFileRoute } from "@tanstack/solid-router";
import { ConvexHttpClient } from "convex/browser";
import crypto from "node:crypto";
import { requireConvexServerSecret } from "~/lib/utils";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";

function createSignature(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

async function handleHookRecordEvent(
  event: Extract<TapEvent, { type: "record" }>,
  convex: ConvexHttpClient,
  CONVEX_SERVER_SECRET: string,
): Promise<Response> {
  console.log("hook record event:", {
    did: event.did,
    collection: event.collection,
    rkey: event.rkey,
    action: event.action,
  });
  const recordUri = `at://${event.did}/${event.collection}/${event.rkey}`;

  if (event.action === "delete") {
    const removed = await convex.mutation(api.hooks.deleteByRecordUri, {
      serverSecret: CONVEX_SERVER_SECRET,
      recordUri,
    });
    console.log(
      `Hook deleted via com.communitytap.hook: ${recordUri}`,
      removed ? "removed" : "not found",
    );
    return new Response(
      JSON.stringify({ handled: true, action: "delete", removed }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const record = event.record;
  if (!record) {
    return new Response(JSON.stringify({ error: "No record body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const nsid = record.nsid as string | undefined;
  const webhookUrl = record.webhookUrl as string | undefined;
  const serviceId = record.serviceId as string | undefined;

  const communityTapServiceId = process.env.COMMUNITY_TAP_SERVICE_ID;
  if (serviceId !== communityTapServiceId) {
    return new Response(
      JSON.stringify({ ignored: true, reason: "serviceId mismatch" }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  if (!nsid || !webhookUrl) {
    return new Response(
      JSON.stringify({
        error: "Invalid hook record: nsid and webhookUrl required",
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const userId = event.did;

  const existingUser = await convex.query(api.users.getByDid, {
    serverSecret: CONVEX_SERVER_SECRET,
    did: userId,
  });
  if (!existingUser) {
    await convex.mutation(api.users.upsert, {
      serverSecret: CONVEX_SERVER_SECRET,
      did: userId,
      handle: userId,
      lastSeen: Date.now(),
    });
  }

  const hookId = await convex.mutation(api.hooks.upsert, {
    serverSecret: CONVEX_SERVER_SECRET,
    userId,
    nsid,
    webhookUrl,
    recordUri,
    isActive: true,
  });

  return new Response(
    JSON.stringify({ handled: true, action: event.action, hookId }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

async function deliverToMatchingHooks(
  event: Extract<TapEvent, { type: "record" }>,
  rawEvent: unknown,
  convex: ConvexHttpClient,
  CONVEX_SERVER_SECRET: string,
): Promise<Response> {
  const collection = event.collection;
  const rawBody = JSON.stringify(rawEvent);
  const action = event.action as "create" | "update" | "delete";

  const nsidHooks = await convex.query(api.hooks.listByNsid, {
    nsid: collection,
  });
  const matchingHooks = nsidHooks.filter((h) => h.isActive);

  if (matchingHooks.length === 0) {
    return new Response(JSON.stringify({ matched: 0, delivered: 0 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const byUser = new Map<string, Doc<"hooks">[]>();
  for (const hook of matchingHooks) {
    const list = byUser.get(hook.userId);
    if (list) {
      list.push(hook);
    } else {
      byUser.set(hook.userId, [hook]);
    }
  }

  let totalDelivered = 0;

  for (const [userId, hooks] of byUser) {
    const hookIds = hooks.map((h) => h._id);

    const reservation = await convex.mutation(api.events.reserveForDelivery, {
      userId,
      hookIds,
      event: {
        repo: event.did,
        collection: event.collection,
        rkey: event.rkey,
        action,
        requestBody: rawBody,
      },
      serverSecret: CONVEX_SERVER_SECRET,
    });

    if (!reservation.allowed) {
      console.log(
        `Skipping deliveries for user ${userId}: ${reservation.reason}`,
      );
      continue;
    }

    const { eventIds } = reservation as { eventIds: string[] };
    const eventIdByHookId = new Map<string, Id<"events">>();
    for (let i = 0; i < hookIds.length; i++) {
      eventIdByHookId.set(hookIds[i], eventIds[i] as Id<"events">);
    }

    const userInfo = await convex.query(api.users.getDeliveryInfo, {
      did: userId,
      serverSecret: CONVEX_SERVER_SECRET,
    });

    const deliverableHooks = hooks.filter((h) => h.pausedReason !== "admin");

    await Promise.allSettled(
      deliverableHooks.map(async (hook) => {
        const eventId = eventIdByHookId.get(hook._id);
        if (!eventId) return;

        const startTime = Date.now();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        try {
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "X-Community-Tap-Event": "true",
            "X-Community-Tap-Nsid": collection,
            "X-Community-Tap-Timestamp": String(startTime),
          };

          if (userInfo?.webhookSigningSecret) {
            const signature = createSignature(
              `${startTime}.${rawBody}`,
              userInfo.webhookSigningSecret,
            );
            headers["X-Community-Tap-Signature"] = `sha256=${signature}`;
          }

          const response = await fetch(hook.webhookUrl, {
            method: "POST",
            headers,
            body: rawBody,
            signal: controller.signal,
          });
          clearTimeout(timeout);
          const duration = Date.now() - startTime;

          await convex.mutation(api.events.patchDeliveryResult, {
            eventId,
            success: response.ok,
            durationMs: duration,
            responseStatus: response.status,
            serverSecret: CONVEX_SERVER_SECRET,
          });

          if (response.ok) totalDelivered++;
        } catch (error) {
          clearTimeout(timeout);
          const duration = Date.now() - startTime;
          const errorMsg =
            error instanceof Error ? error.message : "Unknown error";

          await convex.mutation(api.events.patchDeliveryResult, {
            eventId,
            success: false,
            durationMs: duration,
            error: errorMsg,
            serverSecret: CONVEX_SERVER_SECRET,
          });
        }
      }),
    );
  }

  return new Response(
    JSON.stringify({
      matched: matchingHooks.length,
      delivered: totalDelivered,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

export const Route = createFileRoute("/api/tap-events")({
  server: {
    handlers: {
      GET: async () => {
        console.log("get");
        return new Response(JSON.stringify({ status: "ok" }), {
          headers: { "Content-Type": "application/json" },
        });
      },
      POST: async ({ request }) => {
        const convexUrl = process.env.VITE_CONVEX_URL;
        if (!convexUrl) {
          throw new Error("VITE_CONVEX_URL is not set");
        }
        const CONVEX_SERVER_SECRET = requireConvexServerSecret();
        const convex = new ConvexHttpClient(convexUrl);

        console.log("Received Tap event");

        const tapPassword = process.env.TAP_ADMIN_PASSWORD;
        if (tapPassword) {
          try {
            assureAdminAuth(
              tapPassword,
              request.headers.get("authorization") ?? "",
            );
          } catch {
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
              status: 401,
              headers: { "Content-Type": "application/json" },
            });
          }
        }

        try {
          const rawEvent = await request.json();
          const eventType = rawEvent?.type;

          if (eventType !== "record") {
            return new Response(
              JSON.stringify({ ignored: true, type: eventType }),
              {
                status: 200,
                headers: { "Content-Type": "application/json" },
              },
            );
          }

          const event = parseTapEvent(rawEvent) as Extract<
            TapEvent,
            { type: "record" }
          >;

          if (event.collection === "com.communitytap.hook") {
            return await handleHookRecordEvent(
              event,
              convex,
              CONVEX_SERVER_SECRET,
            );
          }

          return await deliverToMatchingHooks(
            event,
            rawEvent,
            convex,
            CONVEX_SERVER_SECRET,
          );
        } catch (error) {
          console.error("Error handling tap event:", error);
          return new Response(
            JSON.stringify({ error: "Internal server error" }),
            {
              status: 500,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
      },
    },
  },
});
