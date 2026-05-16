import { Link } from "@tanstack/solid-router";
import { createSignal, For, Show } from "solid-js";
import { Route } from "~/routes/dashboard";
import {
  createHookOnPDS as createHookAction,
  deleteHookOnPDS as deleteHookAction,
  syncHooksFromPDS as syncAction,
} from "~/routes/dashboard/-actions";
import { listHooks } from "~/routes/dashboard/-queries";

export default function DashboardPage() {
  const loaderData = Route.useLoaderData();

  const [hooks, setHooks] = createSignal(loaderData().hooks);
  const [loading, setLoading] = createSignal(false);
  const [showNewForm, setShowNewForm] = createSignal(false);
  const [syncResult, setSyncResult] = createSignal<string | null>(null);
  const [lastSync, setLastSync] = createSignal<string | null>(null);

  async function loadHooks() {
    setLoading(true);
    try {
      const result = await listHooks();
      setHooks(result.hooks);
    } catch (err) {
      console.error("Failed to load hooks:", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(recordUri: string) {
    if (!confirm("Are you sure you want to delete this hook?")) return;
    try {
      await deleteHookAction({ data: { uri: recordUri } });
      await loadHooks();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete hook");
    }
  }

  async function handleSync() {
    setLoading(true);
    try {
      const result = await syncAction();
      setSyncResult(`Added ${result.added}, removed ${result.removed}`);
      setLastSync(new Date().toLocaleString());
      await loadHooks();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setLoading(false);
    }
  }

  function truncateUrl(url: string, maxLen = 40) {
    return url.length > maxLen ? `${url.slice(0, maxLen)}...` : url;
  }

  function formatDate(ts: number) {
    return new Date(ts).toLocaleDateString();
  }

  return (
    <div class="container mx-auto px-4 py-8">
      <div class="flex justify-between items-center mb-8">
        <h1 class="text-2xl font-bold">Your hooks</h1>
        <div class="flex gap-3">
          <button
            type="button"
            onClick={handleSync}
            disabled={loading()}
            class="px-4 py-2 border rounded-md hover:bg-zinc-50 disabled:opacity-50"
          >
            {loading() ? "Syncing..." : "Sync from AT Proto"}
          </button>
          <button
            type="button"
            onClick={() => setShowNewForm(true)}
            class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Add hook
          </button>
        </div>
      </div>

      <Show
        when={hooks().some(
          (h) => h.pausedAt && h.pausedReason && h.pausedReason !== "admin",
        )}
      >
        <div class="mb-4 p-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-md text-sm">
          <strong>Delivery paused</strong> — daily limit (1000 events) or
          minute limit (50 events) reached. Resumes automatically when the
          relevant window resets at the top of the minute or at midnight UTC.
        </div>
      </Show>

      <Show
        when={hooks().some(
          (h) => h.pausedAt && h.pausedReason === "admin",
        )}
      >
        <div class="mb-4 p-3 bg-red-50 border border-red-200 text-red-800 rounded-md text-sm">
          <strong>Hook paused by admin</strong> — one or more of your hooks
          have been paused by the Community Tap administrator.
        </div>
      </Show>

      <Show when={syncResult()}>
        <div class="mb-4 p-3 bg-green-50 text-green-700 rounded-md text-sm">
          {syncResult()}
          {lastSync() && (
            <span class="ml-2 text-zinc-500">(last sync: {lastSync()})</span>
          )}
        </div>
      </Show>

      <Show when={hooks().length === 0}>
        <div class="text-center py-12 border rounded-lg bg-zinc-50">
          <p class="text-zinc-600 mb-4">You don't have any hooks yet.</p>
          <button
            type="button"
            onClick={() => setShowNewForm(true)}
            class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Add your first hook
          </button>
        </div>
      </Show>

      <Show when={hooks().length > 0}>
        <div class="border rounded-lg overflow-hidden">
          <table class="w-full">
            <thead class="bg-zinc-50 border-b">
              <tr>
                <th class="px-4 py-3 text-left text-sm font-medium text-zinc-600">
                  NSID
                </th>
                <th class="px-4 py-3 text-left text-sm font-medium text-zinc-600">
                  Webhook URL
                </th>
                <th class="px-4 py-3 text-left text-sm font-medium text-zinc-600">
                  Created
                </th>
                <th class="px-4 py-3 text-left text-sm font-medium text-zinc-600">
                  Status
                </th>
                <th class="px-4 py-3 text-right text-sm font-medium text-zinc-600">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              <For each={hooks()}>
                {(hook) => (
                  <tr class="border-b last:border-b-0 hover:bg-zinc-50">
                    <td class="px-4 py-3 text-sm font-mono">
                      <Link
                        to="/dashboard/hooks/$hookId"
                        params={{ hookId: hook._id }}
                        class="text-blue-600 hover:underline"
                      >
                        {hook.nsid}
                      </Link>
                    </td>
                    <td class="px-4 py-3 text-sm text-zinc-600">
                      {truncateUrl(hook.webhookUrl)}
                    </td>
                    <td class="px-4 py-3 text-sm text-zinc-600">
                      {formatDate(hook.createdAt)}
                    </td>
                    <td class="px-4 py-3">
                      <Show when={hook.pausedAt && hook.pausedReason === "admin"}>
                        <span class="inline-flex px-2 py-1 text-xs rounded-full bg-red-100 text-red-700">
                          Admin Paused
                        </span>
                      </Show>
                      <Show when={hook.pausedAt && hook.pausedReason && hook.pausedReason !== "admin"}>
                        <span class="inline-flex px-2 py-1 text-xs rounded-full bg-amber-100 text-amber-700">
                          Limited
                        </span>
                      </Show>
                      <Show when={!hook.pausedAt && hook.isActive}>
                        <span class="inline-flex px-2 py-1 text-xs rounded-full bg-green-100 text-green-700">
                          Active
                        </span>
                      </Show>
                      <Show when={!hook.isActive}>
                        <span class="inline-flex px-2 py-1 text-xs rounded-full bg-zinc-100 text-zinc-600">
                          Inactive
                        </span>
                      </Show>
                    </td>
                    <td class="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleDelete(hook.recordUri)}
                        class="text-sm text-red-600 hover:text-red-700"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>

      <Show when={showNewForm()}>
        <NewHookModal
          onClose={() => setShowNewForm(false)}
          onSuccess={loadHooks}
        />
      </Show>
    </div>
  );
}

function NewHookModal(props: { onClose: () => void; onSuccess: () => void }) {
  const [nsid, setNsid] = createSignal("");
  const [webhookUrl, setWebhookUrl] = createSignal("");
  const [error, setError] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);
  const [nsidError, setNsidError] = createSignal("");

  const nsidRegex = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/;

  function validateNsid() {
    if (!nsid()) return;
    if (!nsidRegex.test(nsid())) {
      setNsidError("Invalid NSID format (e.g., app.bsky.feed.post)");
      return false;
    }
    setNsidError("");
    return true;
  }

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    setError("");

    if (!validateNsid()) return;

    if (!webhookUrl()) {
      setError("Webhook URL is required");
      return;
    }

    // Basic URL validation
    try {
      void new URL(webhookUrl());
    } catch {
      setError("Invalid webhook URL");
      return;
    }

    setSubmitting(true);
    try {
      await createHookAction({
        data: { nsid: nsid(), webhookUrl: webhookUrl() },
      });
      props.onClose();
      props.onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create hook");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div class="bg-white rounded-lg p-6 w-full max-w-md mx-4">
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-lg font-bold">Add new hook</h2>
          <button
            type="button"
            onClick={props.onClose}
            class="text-zinc-400 hover:text-zinc-600"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} class="space-y-4">
          <div>
            <label for="nsid" class="block text-sm font-medium mb-1">
              NSID
            </label>
            <input
              id="nsid"
              type="text"
              value={nsid()}
              onInput={(e) => setNsid(e.currentTarget.value)}
              onBlur={validateNsid}
              placeholder="app.bsky.feed.post"
              class={`w-full px-3 py-2 border rounded-md ${nsidError() ? "border-red-500" : ""}`}
              required
            />
            <Show when={nsidError()}>
              <p class="text-red-500 text-xs mt-1">{nsidError()}</p>
            </Show>
          </div>

          <div>
            <label for="webhookUrl" class="block text-sm font-medium mb-1">
              Webhook URL
            </label>
            <input
              id="webhookUrl"
              type="url"
              value={webhookUrl()}
              onInput={(e) => setWebhookUrl(e.currentTarget.value)}
              placeholder="https://example.com/webhook"
              class="w-full px-3 py-2 border rounded-md"
              required
            />
          </div>

          <Show when={error()}>
            <p class="text-red-500 text-sm">{error()}</p>
          </Show>

          <div class="flex gap-3 pt-2">
            <button
              type="button"
              onClick={props.onClose}
              class="flex-1 px-4 py-2 border rounded-md hover:bg-zinc-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting()}
              class="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting() ? "Creating..." : "Create hook"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
