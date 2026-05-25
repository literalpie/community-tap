import { createSignal, Show } from "solid-js";
import {
  generateWebhookSigningSecret as generateSecretAction,
  regenerateWebhookSigningSecret as regenerateSecretAction,
} from "~/routes/dashboard/-actions";
import { getUserWebhookSettings } from "~/routes/dashboard/-queries";

export default function WebhookSettingsModal(props: {
  onClose: () => void;
}) {
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");
  const [success, setSuccess] = createSignal("");
  const [secret, setSecret] = createSignal("");
  const [settings, setSettings] = createSignal<{
    hasWebhookSigningSecret: boolean;
    webhookSigningSecretCreatedAt?: number;
  } | null>(null);

  async function loadSettings() {
    try {
      const result = await getUserWebhookSettings();
      setSettings(result);
    } catch (err) {
      console.error("Failed to load webhook settings:", err);
      setError("Failed to load settings");
    }
  }

  async function handleGenerate() {
    setLoading(true);
    setError("");
    setSuccess("");
    setSecret("");
    
    try {
      const result = await generateSecretAction();
      setSecret(result.secret);
      setSuccess("Webhook signing secret generated successfully!");
      await loadSettings();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to generate secret",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleRegenerate() {
    setLoading(true);
    setError("");
    setSuccess("");
    setSecret("");
    
    try {
      const result = await regenerateSecretAction();
      setSecret(result.secret);
      setSuccess("Webhook signing secret regenerated successfully!");
      await loadSettings();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to regenerate secret",
      );
    } finally {
      setLoading(false);
    }
  }

  function formatDate(timestamp?: number) {
    if (!timestamp) return "Never";
    return new Date(timestamp).toLocaleString();
  }

  return (
    <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div class="bg-white rounded-lg p-6 w-full max-w-md mx-4">
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-lg font-bold">Webhook Signing Settings</h2>
          <button
            type="button"
            onClick={props.onClose}
            class="text-zinc-400 hover:text-zinc-600"
          >
            ✕
          </button>
        </div>

        <div class="space-y-4">
          <p class="text-sm text-zinc-600">
            Webhook signing secrets are used to verify that webhook requests come from Community Tap.
            This helps prevent spoofing and ensures the authenticity of events.
          </p>

          <Show when={settings()?.hasWebhookSigningSecret}>
            <div class="p-3 bg-zinc-50 rounded-md">
              <p class="text-sm font-medium">Current Status</p>
              <p class="text-sm text-zinc-600">
                Webhook signing is <span class="font-semibold text-green-600">enabled</span>
              </p>
              <p class="text-sm text-zinc-500 mt-1">
                Created: {formatDate(settings()?.webhookSigningSecretCreatedAt)}
              </p>
            </div>
          </Show>

          <Show when={!settings()?.hasWebhookSigningSecret}>
            <div class="p-3 bg-zinc-50 rounded-md">
              <p class="text-sm font-medium">Current Status</p>
              <p class="text-sm text-zinc-600">
                Webhook signing is <span class="font-semibold text-zinc-600">disabled</span>
              </p>
            </div>
          </Show>

          <Show when={secret()}>
            <div class="p-3 bg-blue-50 border border-blue-200 rounded-md">
              <p class="text-sm font-medium text-blue-800">New Webhook Signing Secret</p>
              <div class="mt-2 p-2 bg-white border rounded-md">
                <code class="text-sm font-mono break-all">{secret()}</code>
              </div>
              <p class="text-xs text-blue-600 mt-2">
                ⚠️ Copy this secret now. It will not be shown again.
              </p>
            </div>
          </Show>

          <Show when={error()}>
            <p class="text-red-500 text-sm">{error()}</p>
          </Show>

          <Show when={success() && !secret()}>
            <p class="text-green-500 text-sm">{success()}</p>
          </Show>

          <div class="flex gap-3 pt-2">
            <button
              type="button"
              onClick={props.onClose}
              class="flex-1 px-4 py-2 border rounded-md hover:bg-zinc-50"
            >
              Close
            </button>
            <Show when={!settings()?.hasWebhookSigningSecret}>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={loading()}
                class="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {loading() ? "Generating..." : "Generate Secret"}
              </button>
            </Show>
            <Show when={settings()?.hasWebhookSigningSecret}>
              <button
                type="button"
                onClick={handleRegenerate}
                disabled={loading()}
                class="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {loading() ? "Regenerating..." : "Regenerate Secret"}
              </button>
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
}