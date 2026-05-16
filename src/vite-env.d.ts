/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CONVEX_URL: string;
  readonly VITE_TAP_BASE_URL?: string;
  readonly VITE_URL?: string;
  readonly VITE_PUBLIC_URL?: string;
  readonly VITE_IS_PROD?: string;
}

export interface ImportMeta {
  readonly env: ImportMetaEnv;
}
