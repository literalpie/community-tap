export const getPublicUrl = () => {
  const serverEnv = typeof process !== 'undefined' ? process.env : undefined
  const url =
    serverEnv?.PUBLIC_URL ||
    import.meta.env.VITE_URL ||
    serverEnv?.URL ||
    import.meta.env.VITE_PUBLIC_URL ||
    serverEnv?.DEPLOY_PRIME_URL ||
    serverEnv?.DEPLOY_URL

  return url?.replace(/\/+$/, '')
}
