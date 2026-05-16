import { createServerFn } from "@tanstack/solid-start";
import { getCookie } from "@tanstack/solid-start/server";
import { getOAuthClient } from "~/auth/client";

export const getSessionFn = createServerFn({ method: "GET" }).handler(
  async () => {
    try {
      const did = getCookie("did");
      console.log("[session] cookie did:", did);
      if (!did) {
        console.log("[session] no did cookie found");
        return { session: null };
      }

      const client = await getOAuthClient();
      const session = await client.restore(did);
      console.log(
        "[session] restored session:",
        session ? "success" : "failed",
      );

      return { session: session ? { did: session.did } : null };
    } catch (error) {
      console.error("[session] error:", error);
      return { session: null };
    }
  },
);
