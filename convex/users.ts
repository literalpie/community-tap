import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireServerSecret } from "./helpers";

export const upsert = mutation({
  args: {
    serverSecret: v.string(),
    did: v.string(),
    handle: v.string(),
    lastSeen: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret);

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
  args: {
    serverSecret: v.string(),
    did: v.string(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret);

    return await ctx.db
      .query("users")
      .withIndex("by_did", (q) => q.eq("did", args.did))
      .first();
  },
});

export const getDeliveryInfo = query({
  args: {
    did: v.string(),
    serverSecret: v.string(),
  },
  handler: async (ctx, { did, serverSecret }) => {
    requireServerSecret(serverSecret);
    const user = await ctx.db
      .query("users")
      .withIndex("by_did", (q) => q.eq("did", did))
      .first();
    if (!user) return null;
    return {
      webhookSigningSecret: user.webhookSigningSecret,
    };
  },
});

export const storeApiKeyHash = mutation({
  args: {
    serverSecret: v.string(),
    did: v.string(),
    apiKeyHash: v.string(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret);
    const user = await ctx.db
      .query("users")
      .withIndex("by_did", (q) => q.eq("did", args.did))
      .first();
    if (!user) throw new Error("User not found");
    await ctx.db.patch(user._id, {
      addRepoApiKeyHash: args.apiKeyHash,
      addRepoApiKeyCreatedAt: Date.now(),
    });
  },
});

export const findByApiKeyHash = query({
  args: {
    serverSecret: v.string(),
    apiKeyHash: v.string(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret);
    return await ctx.db
      .query("users")
      .withIndex("by_addRepoApiKeyHash", (q) =>
        q.eq("addRepoApiKeyHash", args.apiKeyHash),
      )
      .first();
  },
});

export const hasApiKey = query({
  args: {
    serverSecret: v.string(),
    did: v.string(),
  },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret);
    const user = await ctx.db
      .query("users")
      .withIndex("by_did", (q) => q.eq("did", args.did))
      .first();
    return !!user?.addRepoApiKeyHash;
  },
});
