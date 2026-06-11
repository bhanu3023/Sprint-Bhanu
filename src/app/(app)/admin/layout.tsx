import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!['SUPER_ADMIN', 'ADMIN'].includes(session.user.role)) redirect('/dashboard')
  return <>{children}</>
}
