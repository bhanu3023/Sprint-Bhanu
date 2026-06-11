import type { Metadata } from 'next'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { UsersView } from '@/components/users/UsersView'

export const metadata: Metadata = { title: 'People' }

export default async function UsersPage() {
  const session = await getSession()
  if (!session) return null

  const users = await prisma.user.findMany({
    select: {
      id: true, name: true, email: true, avatarUrl: true, avatarColor: true,
      role: true, isActive: true, jobTitle: true, department: true, createdAt: true,
      _count: { select: { assignedIssues: true, projectMembers: true } },
    },
    orderBy: { name: 'asc' },
  })

  const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(session.user.role)

  return <UsersView users={users} currentUserId={session.user.id} isAdmin={isAdmin} />
}
