"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";

// Simple transform that flattens the event structure without using @atproto/tap's parser
// This avoids the $type validation issue in Convex
export const parseTapEvent = internalAction({
  args: { rawEvent: v.any() },
  returns: v.any(),
  handler: async (ctx, { rawEvent }) => {
    if (!rawEvent) return null;
    
    if (rawEvent.type === 'record' && rawEvent.record) {
      return {
        id: rawEvent.id,
        type: 'record',
        did: rawEvent.record.did,
        rev: rawEvent.record.rev,
        collection: rawEvent.record.collection,
        rkey: rawEvent.record.rkey,
        action: rawEvent.record.action,
        record: rawEvent.record.record,
        cid: rawEvent.record.cid,
        live: rawEvent.record.live,
      };
    }
    
    if (rawEvent.type === 'identity' && rawEvent.identity) {
      return {
        id: rawEvent.id,
        type: 'identity',
        did: rawEvent.identity.did,
        handle: rawEvent.identity.handle,
        isActive: rawEvent.identity.is_active,
        status: rawEvent.identity.status,
      };
    }
    
    return null;
  },
});