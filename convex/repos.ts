import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireServerSecret } from "./helpers";

export const registerRepo = mutation({
  args: {
    serverSecret: v.string(),
    repoDid: v.string(),
    registeredBy: v.string(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret);

    const existing = await ctx.db
      .query("repoRegistrations")
      .withIndex("by_repo", (q) => q.eq("repoDid", args.repoDid))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        lastSeenAt: Date.now(),
      });
      return existing._id;
    }

    return await ctx.db.insert("repoRegistrations", {
      repoDid: args.repoDid,
      registeredBy: args.registeredBy,
      registeredAt: Date.now(),
      lastSeenAt: Date.now(),
    });
  },
});

export const listByUser = query({
  args: {
    serverSecret: v.string(),
    registeredBy: v.string(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret);

    return await ctx.db
      .query("repoRegistrations")
      .withIndex("by_registeredBy", (q) =>
        q.eq("registeredBy", args.registeredBy),
      )
      .order("desc")
      .collect();
  },
});
