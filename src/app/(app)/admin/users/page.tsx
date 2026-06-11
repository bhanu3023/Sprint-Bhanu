import type { Metadata } from 'next'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { AdminUsersView } from '@/components/admin/AdminUsersView'

export const metadata: Metadata = { title: 'User Management' }

export default async function AdminUsersPage() {
  const session = await getSession()
  if (!session) return null
  if (!['SUPER_ADMIN', 'ADMIN'].includes(session.user.role)) redirect('/dashboard')

  const [users, allProjects] = await Promise.all([
    prisma.user.findMany({
      include: {
        _count: { select: { assignedIssues: true } },
        projectMembers: {
          include: {
            project: { select: { id: true, key: true, name: true, avatarColor: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.project.findMany({
      where: { isArchived: false },
      select: { id: true, key: true, name: true, avatarColor: true },
      orderBy: { name: 'asc' },
    }),
  ])

  return (
    <AdminUsersView
      initialUsers={users.map((u) => ({
        ...u,
        createdAt: u.createdAt.toISOString(),
        projectMembers: u.projectMembers.map((m) => ({
          projectId: m.projectId,
          role: m.role,
          project: m.project,
        })),
      }))}
      allProjects={allProjects}
      currentUserId={session.user.id}
    />
  )
}
