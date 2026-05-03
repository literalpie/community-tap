import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const upsert = mutation({
  args: {
    did: v.string(),
    handle: v.string(),
    lastSeen: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_did", (q) => q.eq("did", args.did))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        handle: args.handle,
        lastSeen: args.lastSeen ?? Date.now(),
      });
      return existing._id;
    } else {
      return await ctx.db.insert("users", {
        did: args.did,
        handle: args.handle,
        lastSeen: args.lastSeen ?? Date.now(),
      });
    }
  },
});

export const getByDid = query({
  args: { did: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_did", (q) => q.eq("did", args.did))
      .first();
  },
});
