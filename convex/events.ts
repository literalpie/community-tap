import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireServerSecret } from "./helpers";

export const logEvent = mutation({
  args: {
    serverSecret: v.string(),
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
    requireServerSecret(args.serverSecret);

    await ctx.db.insert("events", {
      hookId: args.hookId,
      userId: args.userId,
      nsid: args.nsid,
      repo: args.repo,
      collection: args.collection,
      rkey: args.rkey,
      action: args.action,
      webhookUrl: args.webhookUrl,
      requestBody: args.requestBody,
      responseStatus: args.responseStatus,
      responseBody: args.responseBody,
      durationMs: args.durationMs,
      success: args.success,
      error: args.error,
      timestamp: Date.now(),
    });
  },
});

export const getEventsForHook = query({
  args: {
    serverSecret: v.string(),
    hookId: v.id("hooks"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret);

    return await ctx.db
      .query("events")
      .withIndex("by_hook", (q) => q.eq("hookId", args.hookId))
      .order("desc")
      .take(args.limit ?? 50);
  },
});

export const getEventsByUser = query({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret);

    return await ctx.db
      .query("events")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(args.limit ?? 50);
  },
});
