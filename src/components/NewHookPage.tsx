import { useNavigate } from "@tanstack/solid-router";
import { createSignal, Show } from "solid-js";
import { createHookOnPDS } from "~/routes/dashboard/-actions";

export default function NewHookPage() {
  const navigate = useNavigate();
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
      new URL(webhookUrl());
    } catch {
      setError("Invalid webhook URL");
      return;
    }

    setSubmitting(true);
    try {
      await createHookOnPDS({
        data: { nsid: nsid(), webhookUrl: webhookUrl() },
      });
      navigate({ to: "/dashboard" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create hook");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div class="container mx-auto px-4 py-8 max-w-md">
      <h1 class="text-2xl font-bold mb-6">Add new hook</h1>

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
            onClick={() => navigate({ to: "/dashboard" })}
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
  );
}
