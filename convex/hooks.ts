import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const listByUser = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("hooks")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .collect();
  },
});

export const listAll = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("hooks").collect();
  },
});

export const getById = query({
  args: { id: v.id("hooks") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const upsert = mutation({
  args: {
    userId: v.string(),
    nsid: v.string(),
    webhookUrl: v.string(),
    recordUri: v.string(),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("hooks")
      .withIndex("by_recordUri", (q) => q.eq("recordUri", args.recordUri))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        userId: args.userId,
        nsid: args.nsid,
        webhookUrl: args.webhookUrl,
        isActive: args.isActive ?? existing.isActive,
      });
      return existing._id;
    } else {
      return await ctx.db.insert("hooks", {
        userId: args.userId,
        nsid: args.nsid,
        webhookUrl: args.webhookUrl,
        recordUri: args.recordUri,
        isActive: args.isActive ?? true,
        createdAt: args.createdAt ?? Date.now(),
      });
    }
  },
});

export const deleteByRecordUri = mutation({
  args: { recordUri: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("hooks")
      .withIndex("by_recordUri", (q) => q.eq("recordUri", args.recordUri))
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
      return true;
    }
    return false;
  },
});
