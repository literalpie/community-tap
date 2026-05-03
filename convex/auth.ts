import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const getState = query({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    const state = await ctx.db
      .query("authStates")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
    return state;
  },
});

export const setState = mutation({
  args: { key: v.string(), state: v.any() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("authStates")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { state: args.state });
    } else {
      await ctx.db.insert("authStates", { key: args.key, state: args.state });
    }
  },
});

export const delState = mutation({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    const state = await ctx.db
      .query("authStates")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
    if (state) {
      await ctx.db.delete(state._id);
    }
  },
});

export const getSession = query({
  args: { did: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_did", (q) => q.eq("did", args.did))
      .first();
    return session;
  },
});

export const setSession = mutation({
  args: { did: v.string(), session: v.any() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("sessions")
      .withIndex("by_did", (q) => q.eq("did", args.did))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { session: args.session });
    } else {
      await ctx.db.insert("sessions", { did: args.did, session: args.session });
    }
  },
});

export const delSession = mutation({
  args: { did: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_did", (q) => q.eq("did", args.did))
      .first();
    if (session) {
      await ctx.db.delete(session._id);
    }
  },
});
