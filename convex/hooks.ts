import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// Queries

export const listByUser = query({
  args: { userDid: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("hooks")
      .withIndex("by_userDid", (q) => q.eq("userDid", args.userDid))
      .order("desc")
      .collect();
  },
});

export const getByUri = query({
  args: { pdsUri: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("hooks")
      .withIndex("by_pdsUri", (q) => q.eq("pdsUri", args.pdsUri))
      .first();
  },
});

// Mutations

export const upsert = mutation({
  args: {
    userDid: v.string(),
    nsid: v.string(),
    webhookUrl: v.string(),
    pdsUri: v.string(),
    createdAt: v.optional(v.number()),
    enabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("hooks")
      .withIndex("by_pdsUri", (q) => q.eq("pdsUri", args.pdsUri))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        userDid: args.userDid,
        nsid: args.nsid,
        webhookUrl: args.webhookUrl,
        createdAt: args.createdAt ?? existing.createdAt,
        enabled: args.enabled ?? existing.enabled,
      });
      return existing._id;
    } else {
      return await ctx.db.insert("hooks", {
        userDid: args.userDid,
        nsid: args.nsid,
        webhookUrl: args.webhookUrl,
        pdsUri: args.pdsUri,
        createdAt: args.createdAt ?? Date.now(),
        enabled: args.enabled ?? true,
      });
    }
  },
});

export const deleteByUri = mutation({
  args: { pdsUri: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("hooks")
      .withIndex("by_pdsUri", (q) => q.eq("pdsUri", args.pdsUri))
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
      return true;
    }
    return false;
  },
});
