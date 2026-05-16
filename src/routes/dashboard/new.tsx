import { createFileRoute, redirect } from "@tanstack/solid-router";
import NewHookPage from "~/components/NewHookPage";
import { getSessionFn } from "~/routes/-session";

export const Route = createFileRoute("/dashboard/new")({
  component: NewHookPage,
  beforeLoad: async () => {
    const data = await getSessionFn();
    if (!data.session) {
      throw redirect({ to: "/" });
    }
    return { session: data.session };
  },
});
