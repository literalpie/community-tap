import { assureAdminAuth, parseTapEvent, type TapEvent } from "@atproto/tap";
import { createFileRoute } from "@tanstack/solid-router";
import { ConvexHttpClient } from "convex/browser";
import { requireConvexServerSecret } from "~/lib/utils";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";

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

/** Forward an event to a registered hook */
async function deliverToMatchingHooks(
  event: Extract<TapEvent, { type: "record" }>,
  rawEvent: unknown,
  convex: ConvexHttpClient,
  CONVEX_SERVER_SECRET: string,
): Promise<Response> {
  const collection = event.collection;

  const allHooks = await convex.query(api.hooks.listAll, {
    serverSecret: CONVEX_SERVER_SECRET,
  });
  const matchingHooks = allHooks.filter(
    (h) => h.nsid === collection && h.isActive,
  );

  if (matchingHooks.length === 0) {
    return new Response(JSON.stringify({ matched: 0, delivered: 0 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  console.log(
    `Matched ${matchingHooks.length} hooks for collection ${collection}`,
  );

  const deliveries = await Promise.allSettled(
    matchingHooks.map(async (hook: Doc<"hooks">) => {
      const startTime = Date.now();
      let result: {
        hookId: Id<"hooks">;
        success: boolean;
        status?: number;
        error?: string;
        duration: number;
      };

      try {
        const response = await fetch(hook.webhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Community-Tap-Event": "true",
            "X-Community-Tap-Nsid": collection,
          },
          body: JSON.stringify(rawEvent),
        });
        const duration = Date.now() - startTime;
        result = {
          hookId: hook._id,
          success: response.ok,
          status: response.status,
          duration,
        };
      } catch (error) {
        const duration = Date.now() - startTime;
        result = {
          hookId: hook._id,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
          duration,
        };
      }

      const logPayload = {
        serverSecret: CONVEX_SERVER_SECRET,
        hookId: hook._id,
        userId: hook.userId,
        nsid: hook.nsid,
        repo: event.did,
        collection: event.collection,
        rkey: event.rkey,
        action: event.action,
        webhookUrl: hook.webhookUrl,
        requestBody: JSON.stringify(rawEvent),
        responseStatus: result.status,
        durationMs: result.duration,
        success: result.success,
        error: result.error,
      };
      try {
        await convex.mutation(api.events.logEvent, logPayload);
      } catch (logErr) {
        console.error("Failed to log event to Convex:", logErr);
      }

      return result;
    }),
  );

  const delivered = deliveries.filter(
    (d) => d.status === "fulfilled" && d.value?.success,
  ).length;
  const failed = deliveries.length - delivered;

  return new Response(
    JSON.stringify({ matched: matchingHooks.length, delivered, failed }),
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
