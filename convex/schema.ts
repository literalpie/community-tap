import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

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
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_nsid", ["nsid"])
    .index("by_userId_nsid", ["userId", "nsid"])
    .index("by_recordUri", ["recordUri"]),
  users: defineTable({
    did: v.string(),
    handle: v.string(),
    lastSeen: v.number(),
  }).index("by_did", ["did"]),
  events: defineTable({
    hookId: v.id("hooks"),
    userId: v.string(),
    nsid: v.string(),
    repo: v.string(),
    collection: v.string(),
    rkey: v.optional(v.string()),
    action: v.union(v.literal("create"), v.literal("update"), v.literal("delete")),
    webhookUrl: v.string(),
    requestBody: v.string(),
    responseStatus: v.optional(v.number()),
    responseBody: v.optional(v.string()),
    durationMs: v.number(),
    success: v.boolean(),
    error: v.optional(v.string()),
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
})
