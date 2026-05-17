import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireServerSecret } from "./helpers";

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

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

export const reserveForDelivery = mutation({
  args: {
    userId: v.string(),
    hookIds: v.array(v.id("hooks")),
    event: v.object({
      repo: v.string(),
      collection: v.string(),
      rkey: v.optional(v.string()),
      action: v.union(
        v.literal("create"),
        v.literal("update"),
        v.literal("delete"),
      ),
      requestBody: v.string(),
    }),
    serverSecret: v.string(),
  },
  handler: async (ctx, { userId, hookIds, event, serverSecret }) => {
    requireServerSecret(serverSecret);

    const DAILY_LIMIT = 1000;
    const MINUTE_LIMIT = 50;

    const now = Date.now();
    const dailyWindow = Math.floor(now / MS_PER_DAY) * MS_PER_DAY;
    const minuteWindow = Math.floor(now / MS_PER_MINUTE) * MS_PER_MINUTE;

    const userHooks = await ctx.db
      .query("hooks")
      .withIndex("by_userId_and_pausedAt", (q) => q.eq("userId", userId))
      .collect();

    await Promise.all(
      userHooks
        .filter(
          (h) =>
            h.pausedAt &&
            h.pausedReason &&
            h.pausedReason !== "admin" &&
            ((h.pausedReason === "daily_limit" && h.pausedAt < dailyWindow) ||
              (h.pausedReason === "minute_limit" && h.pausedAt < minuteWindow)),
        )
        .map((h) =>
          ctx.db.patch(h._id, { pausedAt: undefined, pausedReason: undefined }),
        ),
    );

    const minuteEvents = await ctx.db
      .query("events")
      .withIndex("by_user", (q) =>
        q.eq("userId", userId).gte("timestamp", minuteWindow),
      )
      .take(MINUTE_LIMIT);

    const dailyEvents = await ctx.db
      .query("events")
      .withIndex("by_user", (q) =>
        q.eq("userId", userId).gte("timestamp", dailyWindow),
      )
      .take(DAILY_LIMIT);

    if (minuteEvents.length >= MINUTE_LIMIT) {
      await Promise.all(
        userHooks
          .filter((h) => h.isActive && !h.pausedAt)
          .map((h) =>
            ctx.db.patch(h._id, {
              pausedAt: now,
              pausedReason: "minute_limit",
            }),
          ),
      );
      return { allowed: false, reason: "minute_limit" as const };
    }

    if (dailyEvents.length >= DAILY_LIMIT) {
      await Promise.all(
        userHooks
          .filter((h) => h.isActive && !h.pausedAt)
          .map((h) =>
            ctx.db.patch(h._id, { pausedAt: now, pausedReason: "daily_limit" }),
          ),
      );
      return { allowed: false, reason: "daily_limit" as const };
    }

    const eventIds = (
      await Promise.all(
        hookIds.map(async (hookId) => {
          const hook = userHooks.find((h) => h._id === hookId);
          if (!hook) return null;

          return await ctx.db.insert("events", {
            hookId,
            userId,
            nsid: hook.nsid,
            repo: event.repo,
            collection: event.collection,
            rkey: event.rkey,
            action: event.action,
            webhookUrl: hook.webhookUrl,
            requestBody: event.requestBody,
            durationMs: 0,
            success: false,
            deliveryStatus: "reserved",
            timestamp: now,
          });
        }),
      )
    ).filter((id): id is Id<"events"> => id !== null);

    return { allowed: true, eventIds };
  },
});

export const patchDeliveryResult = mutation({
  args: {
    eventId: v.id("events"),
    success: v.boolean(),
    durationMs: v.number(),
    responseStatus: v.optional(v.number()),
    responseBody: v.optional(v.string()),
    error: v.optional(v.string()),
    serverSecret: v.string(),
  },
  handler: async (
    ctx,
    {
      eventId,
      success,
      durationMs,
      responseStatus,
      responseBody,
      error,
      serverSecret,
    },
  ) => {
    requireServerSecret(serverSecret);

    await ctx.db.patch(eventId, {
      success,
      durationMs,
      responseStatus,
      responseBody,
      error,
      deliveryStatus: success ? "delivered" : "failed",
    });
  },
});
