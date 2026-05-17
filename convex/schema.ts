import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  authStates: defineTable({
    key: v.string(),
    state: v.any(),
  }).index("by_key", ["key"]),
  sessions: defineTable({
    did: v.string(),
    session: v.any(),
  }).index("by_did", ["did"]),
  hooks: defineTable({
    userId: v.string(),
    nsid: v.string(),
    webhookUrl: v.string(),
    recordUri: v.string(),
    isActive: v.boolean(),
    pausedAt: v.optional(v.number()),
    pausedReason: v.optional(
      v.union(
        v.literal("daily_limit"),
        v.literal("minute_limit"),
        v.literal("admin"),
      ),
    ),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_nsid", ["nsid"])
    .index("by_userId_nsid", ["userId", "nsid"])
    .index("by_recordUri", ["recordUri"])
    .index("by_userId_and_pausedAt", ["userId", "pausedAt"]),
  users: defineTable({
    did: v.string(),
    handle: v.string(),
    lastSeen: v.number(),
    addRepoApiKeyHash: v.optional(v.string()),
    addRepoApiKeyCreatedAt: v.optional(v.number()),
    webhookSigningSecret: v.optional(v.string()),
    webhookSigningSecretCreatedAt: v.optional(v.number()),
  })
    .index("by_did", ["did"])
    .index("by_addRepoApiKeyHash", ["addRepoApiKeyHash"]),
  events: defineTable({
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
    deliveryStatus: v.optional(
      v.union(
        v.literal("reserved"),
        v.literal("delivered"),
        v.literal("failed"),
      ),
    ),
    timestamp: v.number(),
  })
    .index("by_hook", ["hookId", "timestamp"])
    .index("by_user", ["userId", "timestamp"])
    .index("by_time", ["timestamp"]),

  repoRegistrations: defineTable({
    repoDid: v.string(),
    registeredBy: v.string(),
    registeredAt: v.number(),
    lastSeenAt: v.number(),
  })
    .index("by_repo", ["repoDid"])
    .index("by_registeredBy", ["registeredBy"]),
});
