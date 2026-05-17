// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

const SERVER_SECRET = "test-secret";
const USER_ID = "user1";
const NSID = "ns1";

async function seedHook(
  t: ReturnType<typeof convexTest>,
  overrides: Record<string, unknown> = {},
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("hooks", {
      userId: USER_ID,
      nsid: NSID,
      webhookUrl: "https://example.com/hook",
      recordUri: "at://did:plc:test/app.bsky.feed.post/1",
      isActive: true,
      createdAt: Date.now(),
      ...overrides,
    });
  });
}

function makeEvent() {
  return {
    repo: "did:plc:test",
    collection: "app.bsky.feed.post",
    action: "create" as const,
    requestBody: JSON.stringify({ test: true }),
  };
}

async function seedEvents(
  t: ReturnType<typeof convexTest>,
  hookId: string,
  count: number,
  timestamp: number,
) {
  await t.run(async (ctx) => {
    for (let i = 0; i < count; i++) {
      await ctx.db.insert("events", {
        hookId,
        userId: USER_ID,
        nsid: NSID,
        repo: "did:plc:test",
        collection: "app.bsky.feed.post",
        action: "create",
        webhookUrl: "https://example.com/hook",
        requestBody: JSON.stringify({ test: true }),
        durationMs: 0,
        success: false,
        timestamp,
      });
    }
  });
}

describe("reserveForDelivery", () => {
  test("reserves events when under all limits", async () => {
    const t = convexTest(schema, modules);
    const hookId = await seedHook(t);

    const result = await t.mutation(api.events.reserveForDelivery, {
      userId: USER_ID,
      hookIds: [hookId],
      event: makeEvent(),
      serverSecret: SERVER_SECRET,
    });

    expect(result).toEqual({ allowed: true, eventIds: [expect.any(String)] });

    const events = await t.run(async (ctx) => {
      return await ctx.db.query("events").collect();
    });
    expect(events).toHaveLength(1);
    expect(events[0].deliveryStatus).toBe("reserved");
    expect(events[0].hookId).toBe(hookId);
  });

  test("reserves events for multiple hookIds", async () => {
    const t = convexTest(schema, modules);
    const hookId1 = await seedHook(t, { nsid: "ns1" });
    const hookId2 = await seedHook(t, {
      userId: USER_ID,
      nsid: "ns2",
      webhookUrl: "https://example.com/hook2",
    });

    const result = await t.mutation(api.events.reserveForDelivery, {
      userId: USER_ID,
      hookIds: [hookId1, hookId2],
      event: makeEvent(),
      serverSecret: SERVER_SECRET,
    });

    expect(result.allowed).toBe(true);
    expect(result.eventIds).toHaveLength(2);
  });

  test("denies when minute limit exceeded and pauses active hooks", async () => {
    const t = convexTest(schema, modules);
    const hookId = await seedHook(t);
    const now = Date.now();
    const minuteStart = Math.floor(now / MS_PER_MINUTE) * MS_PER_MINUTE;

    await seedEvents(t, hookId, 50, minuteStart);

    const result = await t.mutation(api.events.reserveForDelivery, {
      userId: USER_ID,
      hookIds: [hookId],
      event: makeEvent(),
      serverSecret: SERVER_SECRET,
    });

    expect(result).toEqual({ allowed: false, reason: "minute_limit" });

    const hooks = await t.run(async (ctx) => {
      return await ctx.db.query("hooks").collect();
    });
    expect(hooks[0].pausedReason).toBe("minute_limit");
    expect(hooks[0].pausedAt).toEqual(expect.any(Number));
  });

  test("denies when daily limit exceeded and pauses active hooks", async () => {
    const t = convexTest(schema, modules);
    const hookId = await seedHook(t);
    const now = Date.now();
    const dayStart = Math.floor(now / MS_PER_DAY) * MS_PER_DAY;

    await seedEvents(t, hookId, 1000, dayStart);

    const result = await t.mutation(api.events.reserveForDelivery, {
      userId: USER_ID,
      hookIds: [hookId],
      event: makeEvent(),
      serverSecret: SERVER_SECRET,
    });

    expect(result).toEqual({ allowed: false, reason: "daily_limit" });

    const hooks = await t.run(async (ctx) => {
      return await ctx.db.query("hooks").collect();
    });
    expect(hooks[0].pausedReason).toBe("daily_limit");
  });

  test("auto-resumes daily_limit pause when window has expired", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const dayStart = Math.floor(now / MS_PER_DAY) * MS_PER_DAY;
    const hookId = await seedHook(t, {
      pausedAt: dayStart - 1,
      pausedReason: "daily_limit",
    });

    const result = await t.mutation(api.events.reserveForDelivery, {
      userId: USER_ID,
      hookIds: [hookId],
      event: makeEvent(),
      serverSecret: SERVER_SECRET,
    });

    expect(result.allowed).toBe(true);

    const hooks = await t.run(async (ctx) => {
      return await ctx.db.query("hooks").collect();
    });
    expect(hooks[0].pausedAt).toBeUndefined();
    expect(hooks[0].pausedReason).toBeUndefined();
  });

  test("auto-resumes minute_limit pause when window has expired", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const minuteStart = Math.floor(now / MS_PER_MINUTE) * MS_PER_MINUTE;
    const hookId = await seedHook(t, {
      pausedAt: minuteStart - 1,
      pausedReason: "minute_limit",
    });

    const result = await t.mutation(api.events.reserveForDelivery, {
      userId: USER_ID,
      hookIds: [hookId],
      event: makeEvent(),
      serverSecret: SERVER_SECRET,
    });

    expect(result.allowed).toBe(true);

    const hooks = await t.run(async (ctx) => {
      return await ctx.db.query("hooks").collect();
    });
    expect(hooks[0].pausedAt).toBeUndefined();
    expect(hooks[0].pausedReason).toBeUndefined();
  });

  test("does NOT auto-resume admin pause", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const dayStart = Math.floor(now / MS_PER_DAY) * MS_PER_DAY;
    const hookId = await seedHook(t, {
      pausedAt: dayStart - 1,
      pausedReason: "admin",
    });

    const result = await t.mutation(api.events.reserveForDelivery, {
      userId: USER_ID,
      hookIds: [hookId],
      event: makeEvent(),
      serverSecret: SERVER_SECRET,
    });

    expect(result.allowed).toBe(true);

    const hooks = await t.run(async (ctx) => {
      return await ctx.db.query("hooks").collect();
    });
    expect(hooks[0].pausedAt).toBe(dayStart - 1);
    expect(hooks[0].pausedReason).toBe("admin");
  });

  test("does NOT auto-resume non-expired daily_limit pause", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const dayStart = Math.floor(now / MS_PER_DAY) * MS_PER_DAY;
    const hookId = await seedHook(t, {
      pausedAt: dayStart + 1000,
      pausedReason: "daily_limit",
    });

    const result = await t.mutation(api.events.reserveForDelivery, {
      userId: USER_ID,
      hookIds: [hookId],
      event: makeEvent(),
      serverSecret: SERVER_SECRET,
    });

    expect(result.allowed).toBe(true);

    const hooks = await t.run(async (ctx) => {
      return await ctx.db.query("hooks").collect();
    });
    expect(hooks[0].pausedAt).toBe(dayStart + 1000);
    expect(hooks[0].pausedReason).toBe("daily_limit");
  });
});

describe("patchDeliveryResult", () => {
  async function seedReservedEvent(
    t: ReturnType<typeof convexTest>,
    hookId: string,
  ) {
    return await t.run(async (ctx) => {
      return await ctx.db.insert("events", {
        hookId,
        userId: USER_ID,
        nsid: NSID,
        repo: "did:plc:test",
        collection: "app.bsky.feed.post",
        action: "create",
        webhookUrl: "https://example.com/hook",
        requestBody: JSON.stringify({ test: true }),
        durationMs: 0,
        success: false,
        deliveryStatus: "reserved",
        timestamp: Date.now(),
      });
    });
  }

  test("marks event as delivered on success", async () => {
    const t = convexTest(schema, modules);
    const hookId = await seedHook(t);
    const eventId = await seedReservedEvent(t, hookId);

    await t.mutation(api.events.patchDeliveryResult, {
      eventId,
      success: true,
      durationMs: 150,
      responseStatus: 200,
      responseBody: "ok",
      serverSecret: SERVER_SECRET,
    });

    const events = await t.run(async (ctx) => {
      return await ctx.db.query("events").collect();
    });
    expect(events[0].deliveryStatus).toBe("delivered");
    expect(events[0].success).toBe(true);
    expect(events[0].durationMs).toBe(150);
    expect(events[0].responseStatus).toBe(200);
  });

  test("marks event as failed on failure", async () => {
    const t = convexTest(schema, modules);
    const hookId = await seedHook(t);
    const eventId = await seedReservedEvent(t, hookId);

    await t.mutation(api.events.patchDeliveryResult, {
      eventId,
      success: false,
      durationMs: 5000,
      responseStatus: 500,
      responseBody: "Internal Server Error",
      error: "Server returned 500",
      serverSecret: SERVER_SECRET,
    });

    const events = await t.run(async (ctx) => {
      return await ctx.db.query("events").collect();
    });
    expect(events[0].deliveryStatus).toBe("failed");
    expect(events[0].success).toBe(false);
    expect(events[0].error).toBe("Server returned 500");
  });

  test("rejects invalid server secret", async () => {
    const t = convexTest(schema, modules);
    const hookId = await seedHook(t);
    const eventId = await seedReservedEvent(t, hookId);

    await expect(
      t.mutation(api.events.patchDeliveryResult, {
        eventId,
        success: true,
        durationMs: 0,
        serverSecret: "wrong-secret",
      }),
    ).rejects.toThrow("Invalid server secret");
  });
});
