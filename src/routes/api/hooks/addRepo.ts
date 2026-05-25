import { Tap } from "@atproto/tap";
import { createFileRoute } from "@tanstack/solid-router";
import { ConvexHttpClient } from "convex/browser";
import crypto from "node:crypto";
import { requireConvexServerSecret } from "~/lib/utils";
import { api } from "../../../../convex/_generated/api";

async function getTapClient() {
  const tapUrl = import.meta.env.VITE_TAP_BASE_URL || "http://localhost:2480";
  const tapPassword = process.env.TAP_ADMIN_PASSWORD;
  return new Tap(tapUrl, { adminPassword: tapPassword });
}

export const Route = createFileRoute("/api/hooks/addRepo")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const convexUrl = process.env.VITE_CONVEX_URL;
        if (!convexUrl) {
          throw new Error("VITE_CONVEX_URL is not set");
        }
        const CONVEX_SERVER_SECRET = requireConvexServerSecret();
        const convex = new ConvexHttpClient(convexUrl);

        try {
          const authHeader = request.headers.get("Authorization") ?? "";
          const apiKey = authHeader.replace("Bearer ", "").trim();
          if (!apiKey) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
              status: 401,
              headers: { "Content-Type": "application/json" },
            });
          }

          const apiKeyHash = crypto
            .createHash("sha256")
            .update(apiKey)
            .digest("hex");

          const user = await convex.query(api.users.findByApiKeyHash, {
            serverSecret: CONVEX_SERVER_SECRET,
            apiKeyHash,
          });

          if (!user) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
              status: 401,
              headers: { "Content-Type": "application/json" },
            });
          }

          const body = await request.json();
          const { repoDid } = body;

          if (typeof repoDid !== "string") {
            return new Response(
              JSON.stringify({ error: "repoDid is required" }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              },
            );
          }

          let tapSuccess = false;
          try {
            const tap = await getTapClient();
            await tap.addRepos([repoDid]);
            tapSuccess = true;
          } catch (tapError) {
            console.error("Tap error:", tapError);
          }

          if (!tapSuccess) {
            return new Response(
              JSON.stringify({
                error: "Failed to register repo with Tap service",
              }),
              {
                status: 502,
                headers: { "Content-Type": "application/json" },
              },
            );
          }

          await convex.mutation(api.repos.registerRepo, {
            serverSecret: CONVEX_SERVER_SECRET,
            repoDid,
            registeredBy: user.did,
          });

          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (error) {
          console.error("Error registering repo:", error);
          return new Response(
            JSON.stringify({
              error: error instanceof Error ? error.message : "Unknown error",
            }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
