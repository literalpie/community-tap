export const getPublicUrl = () => {
  const serverEnv = typeof process !== 'undefined' ? process.env : undefined
  const isProduction =
    serverEnv?.CONTEXT === 'production' || import.meta.env.VITE_IS_PROD === 'true'
  const envUrl = isProduction
    ? import.meta.env.VITE_URL
    : import.meta.env.VITE_PUBLIC_URL
  const url =
    serverEnv?.PUBLIC_URL ||
    envUrl ||
    serverEnv?.URL ||
    serverEnv?.DEPLOY_PRIME_URL ||
    serverEnv?.DEPLOY_URL

  return url?.replace(/\/+$/, '')
}
