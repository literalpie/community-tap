import { query, internalMutation } from "./_generated/server";
import { v } from "convex/values";

export const logEvent = internalMutation({
  args: {
    hookId: v.id("hooks"),
    userId: v.string(),
    nsid: v.string(),
    repo: v.string(),
    collection: v.string(),
    rkey: v.optional(v.string()),
    action: v.union(
      v.literal("create"),
      v.literal("update"),
      v.literal("delete"),
    ),
    webhookUrl: v.string(),
    requestBody: v.string(),
    responseStatus: v.optional(v.number()),
    responseBody: v.optional(v.string()),
    durationMs: v.number(),
    success: v.boolean(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("events", {
      ...args,
      timestamp: Date.now(),
    });
  },
});

export const getEventsForHook = query({
  args: {
    hookId: v.id("hooks"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { hookId, limit = 50 }) => {
    return await ctx.db
      .query("events")
      .withIndex("by_hook", (q) => q.eq("hookId", hookId))
      .order("desc")
      .take(limit);
  },
});

export const getEventsByUser = query({
  args: {
    userId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { userId, limit = 50 }) => {
    return await ctx.db
      .query("events")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit);
  },
});
