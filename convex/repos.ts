import { query, internalMutation } from "./_generated/server";
import { v } from "convex/values";

export const registerRepo = internalMutation({
  args: {
    repoDid: v.string(),
    registeredBy: v.string(),
  },
  handler: async (ctx, { repoDid, registeredBy }) => {
    const existing = await ctx.db
      .query("repoRegistrations")
      .withIndex("by_repo", (q) => q.eq("repoDid", repoDid))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        lastSeenAt: Date.now(),
      });
      return existing._id;
    }

    return await ctx.db.insert("repoRegistrations", {
      repoDid,
      registeredBy,
      registeredAt: Date.now(),
      lastSeenAt: Date.now(),
    });
  },
});

export const listByUser = query({
  args: { registeredBy: v.string() },
  handler: async (ctx, { registeredBy }) => {
    return await ctx.db
      .query("repoRegistrations")
      .withIndex("by_registeredBy", (q) => q.eq("registeredBy", registeredBy))
      .order("desc")
      .collect();
  },
});
