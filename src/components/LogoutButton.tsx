import { createSignal } from 'solid-js'

export function LogoutButton() {
  const [loading, setLoading] = createSignal(false)

  async function handleLogout() {
    setLoading(true)
    try {
      await fetch('/oauth/logout', { method: 'POST' })
      window.location.reload()
    } catch (error) {
      console.error('Logout error:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleLogout}
      disabled={loading()}
      class="text-sm text-zinc-500 hover:text-zinc-700 disabled:opacity-50"
    >
      {loading() ? 'Signing out...' : 'Sign out'}
    </button>
  )
}
