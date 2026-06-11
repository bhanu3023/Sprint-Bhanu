import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (session?.user) {
    redirect('/dashboard')
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4" style={{ backgroundColor: '#2563EB' }}>
      <div className="w-full max-w-sm">
        {children}
      </div>
      <p className="mt-6 text-white/70 text-sm">© 2026 Neutara Technologies. All rights reserved.</p>
    </div>
  )
}
