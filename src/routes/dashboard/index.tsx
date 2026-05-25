import { createFileRoute, redirect } from "@tanstack/solid-router";
import DashboardPage from "~/components/DashboardPage";
import { getSessionFn } from "~/routes/-session";
import { listHooks } from "~/routes/dashboard/-queries";

export const Route = createFileRoute("/dashboard/")({
  component: DashboardPage,
  beforeLoad: async () => {
    const data = await getSessionFn();
    if (!data.session) {
      throw redirect({ to: "/" });
    }
    return { session: data.session };
  },
  loader: async () => {
    const result = await listHooks();
    return { hooks: result.hooks, hasAddRepoApiKey: result.hasAddRepoApiKey };
  },
});
