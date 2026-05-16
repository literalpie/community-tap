import { ConvexProvider, setupConvex } from "convex-solidjs";
import type { JSXElement } from "solid-js";

let _client: ReturnType<typeof setupConvex> | null = null;

function getConvexClient() {
  if (!_client) {
    const url = (import.meta as any).env.VITE_CONVEX_URL;
    if (!url) {
      console.error("missing envar VITE_CONVEX_URL");
    }
    _client = setupConvex(url);
  }
  return _client;
}

export default function AppConvexProvider(props: { children: JSXElement }) {
  return (
    <ConvexProvider client={getConvexClient()}>{props.children}</ConvexProvider>
  );
}
