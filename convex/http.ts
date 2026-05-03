import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

declare const process: {
  env: Record<string, string | undefined>;
};

// Helper to check if auth is disabled for local development
function isAuthDisabled(): boolean {
  // return process.env.SKIP_AUTH_CHECKS === "true";
  return true
}

interface TapEvent {
  id: number;
  type: 'record' | 'identity' | 'account' | 'sync';
  record?: {
    did: string;  // This is the repo DID
    collection: string;
    rkey: string;
    action: "create" | "update" | "delete";
    record?: unknown;
    cid?: string;
    rev?: string;
    live?: boolean;
  };
}

const http = httpRouter();

http.route({
  path: "/tap/events",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    console.log('got an event!')
    if (!isAuthDisabled()) {
      const authHeader = request.headers.get("x-tap-secret");
      const tapSecret = process.env.TAP_WEBHOOK_SECRET;

      if (!tapSecret || authHeader !== tapSecret) {
        return new Response("Unauthorized", { status: 401 });
      }
    }

    const event = await request.json() as TapEvent;
    
    // Only process 'record' events - silently accept others
    if (event.type !== 'record' || !event.record) {
      return new Response(JSON.stringify({ ignored: true, type: event.type }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    
    const { collection, did: repo, rkey, action, record: recordData } = event.record;
    
    if (!collection || typeof collection !== "string") {
      console.log('missing collection')
      return new Response(JSON.stringify({ error: "Missing required field: collection" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const matchingHooks = await ctx.runQuery(
      internal.hooks.findHooksByNsid,
      {
        nsid: collection,
      },
    );
    console.log('matching hooks:', matchingHooks.length)

    if (matchingHooks.length === 0) {
      return new Response("No matching hooks", { status: 200 });
    }

    const deliveries = await Promise.allSettled(
      matchingHooks.map(async (hook) => {
        if (!hook.isActive) {
          return { hookId: hook._id, success: false };
        }

        const startTime = Date.now();
        try {
          const response = await fetch(hook.webhookUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Community-Tap-Event": "true",
              "X-Community-Tap-Nsid": collection,
            },
            body: JSON.stringify(event),
          });

          const duration = Date.now() - startTime;
          const responseBody = await response.text();

          await ctx.runMutation(internal.events.logEvent, {
            hookId: hook._id,
            userId: hook.userId,
            nsid: collection,
            repo: repo,
            collection: collection,
            rkey: rkey,
            action: action,
            webhookUrl: hook.webhookUrl,
            requestBody: JSON.stringify(event),
            responseStatus: response.status,
            responseBody,
            durationMs: duration,
            success: response.ok,
          });

          return { hookId: hook._id, success: response.ok };
        } catch (error) {
          const duration = Date.now() - startTime;

          await ctx.runMutation(internal.events.logEvent, {
            hookId: hook._id,
            userId: hook.userId,
            nsid: collection,
            repo: repo,
            collection: collection,
            rkey: rkey,
            action: action,
            webhookUrl: hook.webhookUrl,
            requestBody: JSON.stringify(event),
            durationMs: duration,
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          });

          return { hookId: hook._id, success: false, error };
        }
      }),
    );

    const summary = {
      delivered: deliveries.filter(
        (d) => d.status === "fulfilled" && d.value.success,
      ).length,
      failed: deliveries.filter(
        (d) =>
          d.status === "rejected" ||
          (d.status === "fulfilled" && !d.value.success),
      ).length,
      total: matchingHooks.length,
    };

    return new Response(JSON.stringify(summary), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

http.route({
  path: "/hooks/addRepo",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.json();
    const { repoDid } = body;

    if (!repoDid || typeof repoDid !== "string") {
      return new Response("Missing repoDid", { status: 400 });
    }

    const hasHook = await ctx.runQuery(
      internal.hooks.checkRepoHasHook,
      {
        repoDid,
      },
    );

    if (!hasHook) {
      return new Response(
        "No hooks found for this repo. Create a hook first.",
        {
          status: 400,
        },
      );
    }

    const tapBaseUrl = process.env.VITE_TAP_BASE_URL ?? 'http://localhost:2480';

    console.log('tapBaseUrl:', tapBaseUrl)
    if (tapBaseUrl) {
      const tapUrl = `${tapBaseUrl}/repos/add`;
      try {
        const tapResponse = await fetch(tapUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ dids: [repoDid] }),
        });
        console.log('repo added to tap, status:', tapResponse.status)
        if (!tapResponse.ok) {
          return new Response(`Tap error: ${tapResponse.status}`, {
            status: 502,
          });
        }
      } catch (error) {
        return new Response(`Tap error: ${error instanceof Error ? error.message : 'Unknown error'}`, {
          status: 502,
        });
      }
    }

    await ctx.runMutation(internal.repos.registerRepo, {
      repoDid,
      registeredBy: body.registeredBy || "unknown",
    });

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

http.route({
  path: "/hello",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    console.log('hello!')

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
      statusText: "OK",
      
    });
  }),
});

export default http;
