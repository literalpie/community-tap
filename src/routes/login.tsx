import { createFileRoute, redirect } from "@tanstack/solid-router";
import { LoginForm } from "~/components/LoginForm";
import { getSessionFn } from "~/routes/-session";

export const Route = createFileRoute("/login")({
  component: LoginPage,
  beforeLoad: async () => {
    const data = await getSessionFn();
    if (data.session) {
      throw redirect({ to: "/dashboard" });
    }
  },
});

function LoginPage() {
  console.log("[login] LoginPage component rendering");
  return (
    <div class="p-8">
      <h1 class="text-4xl font-bold mb-8">Sign In</h1>
      <div class="max-w-md">
        <LoginForm />
      </div>
    </div>
  );
}
