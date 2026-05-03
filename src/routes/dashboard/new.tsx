import { createFileRoute, redirect } from '@tanstack/solid-router'
import { getSessionFn } from '~/routes/-session'
import NewHookPage from '~/components/NewHookPage'

export const Route = createFileRoute('/dashboard/new')({
  component: NewHookPage,
  beforeLoad: async () => {
    const data = await getSessionFn()
    if (!data.session) {
      throw redirect({ to: '/' })
    }
    return { session: data.session }
  },
})
