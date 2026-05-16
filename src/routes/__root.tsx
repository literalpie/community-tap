import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/solid-router";
import { TanStackRouterDevtools } from "@tanstack/solid-router-devtools";

import "@fontsource/inter/400.css";

import { Suspense } from "solid-js";
import { HydrationScript } from "solid-js/web";
import { LogoutButton } from "~/components/LogoutButton";
import { getSessionFn } from "~/routes/-session";
import styleCss from "../styles.css?url";

export const Route = createRootRouteWithContext<{
  session: { did: string } | null;
}>()({
  head: () => ({
    links: [{ rel: "stylesheet", href: styleCss }],
  }),
  loader: async () => {
    const data = await getSessionFn();
    console.log("[root loader] session data:", data);
    return { session: data.session };
  },
  shellComponent: RootComponent,
});

function RootComponent() {
  const data = Route.useLoaderData();

  return (
    <html lang="en">
      <head>
        <HydrationScript />
        <HeadContent />
      </head>
      <body>
        <header class="border-b">
          <div class="container mx-auto px-4 py-3 flex justify-between items-center">
            <a href="/" class="text-xl font-bold">
              Community Tap
            </a>
            <div class="flex items-center gap-4">
              {data().session ? (
                <>
                  <a
                    href="/dashboard"
                    class="text-sm text-blue-600 hover:underline"
                  >
                    Dashboard
                  </a>
                  <span class="text-sm text-zinc-600">
                    {data().session?.did}
                  </span>
                  <LogoutButton />
                </>
              ) : (
                <a href="/" class="text-sm text-blue-600 hover:underline">
                  Sign in
                </a>
              )}
            </div>
          </div>
        </header>
        <Suspense>
          <Outlet />
          <TanStackRouterDevtools />
        </Suspense>
        <Scripts />
      </body>
    </html>
  );
}
