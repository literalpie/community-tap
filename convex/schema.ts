import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  products: defineTable({
    title: v.string(),
    imageId: v.string(),
    price: v.number(),
  }),
  todos: defineTable({
    text: v.string(),
    completed: v.boolean(),
  }),
  authStates: defineTable({
    key: v.string(),
    state: v.any(),
  }).index("by_key", ["key"]),
  sessions: defineTable({
    did: v.string(),
    session: v.any(),
  }).index("by_did", ["did"]),
  hooks: defineTable({
    userDid: v.string(),
    nsid: v.string(),
    webhookUrl: v.string(),
    pdsUri: v.string(),
    createdAt: v.number(),
    enabled: v.boolean(),
  })
    .index("by_userDid", ["userDid"])
    .index("by_pdsUri", ["pdsUri"])
    .index("by_userDid_and_nsid", ["userDid", "nsid"]),
  users: defineTable({
    did: v.string(),
    handle: v.string(),
    lastSeen: v.number(),
  }).index("by_did", ["did"]),
  events: defineTable({
    // Stub — empty for now, Phase 2 fills it
  }),
})
