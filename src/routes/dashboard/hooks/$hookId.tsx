import { createFileRoute, redirect } from "@tanstack/solid-router";
import { For, Show } from "solid-js";
import { getSessionFn } from "~/routes/-session";
import { getHookById } from "~/routes/dashboard/-queries";

export const Route = createFileRoute("/dashboard/hooks/$hookId")({
  component: HookDetailPage,
  beforeLoad: async () => {
    const data = await getSessionFn();
    if (!data.session) {
      throw redirect({ to: "/" });
    }
    return { session: data.session };
  },
  loader: async ({ params }) => {
    const result = await getHookById({ data: { hookId: params.hookId } });
    return result;
  },
});

function formatTime(ts: number) {
  return new Date(ts).toLocaleString();
}

function HookDetailPage() {
  const loaderData = Route.useLoaderData();

  return (
    <div class="container mx-auto px-4 py-8">
      <div class="mb-6">
        <a href="/dashboard" class="text-blue-600 hover:underline">
          ← Back to hooks
        </a>
      </div>

      <div class="bg-white border rounded-lg p-6 mb-8">
        <div class="flex justify-between items-start mb-4">
          <div>
            <h1 class="text-2xl font-bold mb-2">{loaderData().hook.nsid}</h1>
            <p class="text-zinc-600 text-sm font-mono">
              {loaderData().hook.recordUri}
            </p>
          </div>
          <Show
            when={
              loaderData().hook.pausedAt &&
              loaderData().hook.pausedReason === "admin"
            }
          >
            <span class="inline-flex px-3 py-1 text-sm rounded-full bg-red-100 text-red-700">
              Admin Paused
            </span>
          </Show>
          <Show
            when={
              loaderData().hook.pausedAt &&
              loaderData().hook.pausedReason &&
              loaderData().hook.pausedReason !== "admin"
            }
          >
            <span class="inline-flex px-3 py-1 text-sm rounded-full bg-amber-100 text-amber-700">
              {loaderData().hook.pausedReason === "daily_limit"
                ? "Paused — Daily Limit"
                : "Paused — Minute Limit"}
            </span>
          </Show>
          <Show
            when={!loaderData().hook.pausedAt && loaderData().hook.isActive}
          >
            <span class="inline-flex px-3 py-1 text-sm rounded-full bg-green-100 text-green-700">
              Active
            </span>
          </Show>
          <Show when={!loaderData().hook.isActive}>
            <span class="inline-flex px-3 py-1 text-sm rounded-full bg-zinc-100 text-zinc-600">
              Inactive
            </span>
          </Show>
        </div>

        <dl>
          <div class="mb-4">
            <dt class="text-sm font-medium text-zinc-600">Webhook URL</dt>
            <dd class="text-sm font-mono text-zinc-800">
              {loaderData().hook.webhookUrl}
            </dd>
          </div>
          <div>
            <dt class="text-sm font-medium text-zinc-600">Created</dt>
            <dd class="text-sm text-zinc-800">
              {formatTime(loaderData().hook.createdAt)}
            </dd>
          </div>
        </dl>
      </div>

      <div class="bg-white border rounded-lg p-6">
        <h2 class="text-lg font-semibold mb-4">Recent Events</h2>

        <Show when={loaderData().events.length === 0}>
          <p class="text-zinc-500 text-center py-8">No events received yet.</p>
        </Show>

        <Show when={loaderData().events.length > 0}>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-zinc-50 border-b">
                <tr>
                  <th class="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase">
                    Time
                  </th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase">
                    Repo
                  </th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase">
                    Action
                  </th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase">
                    Status
                  </th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase">
                    Duration
                  </th>
                </tr>
              </thead>
              <tbody>
                <For each={loaderData().events}>
                  {(event) => (
                    <tr class={event.success ? "" : "bg-red-50"}>
                      <td class="px-4 py-3 whitespace-nowrap">
                        {formatTime(event.timestamp)}
                      </td>
                      <td
                        class="px-4 py-3 font-mono text-xs max-w-37.5 truncate"
                        title={event.repo}
                      >
                        {event.repo}
                      </td>
                      <td class="px-4 py-3">
                        <span class="px-2 py-1 bg-zinc-100 rounded text-xs">
                          {event.action}
                        </span>
                      </td>
                      <td class="px-4 py-3">
                        {event.success ? (
                          <span class="text-green-600">
                            ✓ {event.responseStatus ?? "-"}
                          </span>
                        ) : (
                          <span class="text-red-600">
                            ✗ {event.error ?? event.responseStatus ?? "Failed"}
                          </span>
                        )}
                      </td>
                      <td class="px-4 py-3 text-zinc-600">
                        {event.durationMs}ms
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </Show>
      </div>
    </div>
  );
}
