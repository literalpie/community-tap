export const getPublicUrl = () => {
  const serverEnv = typeof process !== 'undefined' ? process.env : undefined
  const envUrl = import.meta.env.PROD
    ? import.meta.env.VITE_URL
    : import.meta.env.VITE_PUBLIC_URL
  const url =
    envUrl ||
    serverEnv?.URL ||
    serverEnv?.DEPLOY_PRIME_URL ||
    serverEnv?.DEPLOY_URL

  return url?.replace(/\/+$/, '')
}
