import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireServerSecret } from "./helpers";

export const listByUser = query({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret);

    return await ctx.db
      .query("hooks")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .collect();
  },
});

export const listByNsid = query({
  args: { nsid: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("hooks")
      .withIndex("by_nsid", (q) => q.eq("nsid", args.nsid))
      .collect();
  },
});

export const listAll = query({
  args: { serverSecret: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret);

    return await ctx.db.query("hooks").collect();
  },
});

export const getById = query({
  args: {
    serverSecret: v.string(),
    id: v.id("hooks"),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret);

    return await ctx.db.get(args.id);
  },
});

export const upsert = mutation({
  args: {
    serverSecret: v.string(),
    userId: v.string(),
    nsid: v.string(),
    webhookUrl: v.string(),
    recordUri: v.string(),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret);

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
  args: {
    serverSecret: v.string(),
    recordUri: v.string(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret);

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

export const pause = mutation({
  args: {
    hookId: v.id("hooks"),
    reason: v.union(
      v.literal("daily_limit"),
      v.literal("minute_limit"),
      v.literal("admin"),
    ),
    serverSecret: v.string(),
  },
  handler: async (ctx, { hookId, reason, serverSecret }) => {
    requireServerSecret(serverSecret);
    await ctx.db.patch(hookId, {
      pausedAt: Date.now(),
      pausedReason: reason,
    });
  },
});

export const unpause = mutation({
  args: {
    hookId: v.id("hooks"),
    serverSecret: v.string(),
  },
  handler: async (ctx, { hookId, serverSecret }) => {
    requireServerSecret(serverSecret);
    const hook = await ctx.db.get(hookId);
    if (!hook) return;
    if (hook.pausedReason === "admin") {
      await ctx.db.patch(hookId, {
        pausedAt: undefined,
        pausedReason: undefined,
      });
    }
  },
});
