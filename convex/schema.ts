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
})
