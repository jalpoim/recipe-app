import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/app/')({
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    throw redirect({ to: '/app/library' } as any)
  },
  component: () => null,
})
