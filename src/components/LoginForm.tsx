import { createSignal } from "solid-js";

export function LoginForm() {
  const [handle, setHandle] = createSignal("");
  const [error, setError] = createSignal("");
  const [loading, setLoading] = createSignal(false);

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/oauth/login-api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle: handle() }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Login failed");
      }

      window.location.href = data.redirectUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} class="space-y-4">
      <div>
        <label for="handle" class="block text-sm font-medium mb-1">
          AT-Proto Handle
        </label>
        <input
          id="handle"
          type="text"
          value={handle()}
          onInput={(e) => setHandle(e.currentTarget.value)}
          placeholder="e.g., user.bsky.social"
          class="w-full px-3 py-2 border rounded-md"
          required
        />
      </div>
      {error() && <p class="text-red-500 text-sm">{error()}</p>}
      <button
        type="submit"
        disabled={loading()}
        class="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
      >
        {loading() ? "Signing in..." : "Sign in with AT-Proto"}
      </button>
    </form>
  );
}
