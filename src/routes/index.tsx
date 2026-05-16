import { createFileRoute, redirect } from "@tanstack/solid-router";
import { getSessionFn } from "~/routes/-session";

export const Route = createFileRoute("/")({
  component: Home,
  beforeLoad: async () => {
    const data = await getSessionFn();
    if (data.session) {
      throw redirect({ to: "/dashboard" });
    }
  },
});

function Home() {
  return (
    <div class="p-8">
      <h1 class="text-4xl font-bold mb-8">Welcome to Community Tap</h1>

      <div class="mt-8">
        <a
          href="/login"
          class="inline-block px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          Sign in with AT-Proto
        </a>
      </div>
    </div>
  );
}
