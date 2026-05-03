import { createFileRoute } from '@tanstack/solid-router'
import { LoginForm } from '~/components/LoginForm'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return (
    <div class="p-8">
      <h1 class="text-4xl font-bold mb-8">Welcome to Community Tap</h1>

      <div class="mt-8 max-w-md">
        <LoginForm />
      </div>
    </div>
  )
}
