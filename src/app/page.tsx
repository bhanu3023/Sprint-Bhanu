import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'

export default async function HomePage() {
  try {
    const session = await getSession()
    if (session?.user) {
      redirect('/dashboard')
    }
  } catch {
    // If auth/session fails (e.g. DB), send to login instead of erroring
  }
  redirect('/login')
}
