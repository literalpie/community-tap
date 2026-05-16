import { createRouter as createTanStackRouter } from "@tanstack/solid-router";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    context: { session: null },
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
  });

  return router;
}

declare module "@tanstack/solid-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
