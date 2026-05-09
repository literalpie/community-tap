export const getPublicUrl = () => {
  const serverEnv = typeof process !== 'undefined' ? process.env : undefined
  const url =
    import.meta.env.VITE_PUBLIC_URL ||
    import.meta.env.VITE_URL ||
    serverEnv?.PUBLIC_URL ||
    serverEnv?.URL ||
    serverEnv?.DEPLOY_PRIME_URL ||
    serverEnv?.DEPLOY_URL

  return url?.replace(/\/+$/, '')
}
