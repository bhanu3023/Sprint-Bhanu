import type { Metadata } from 'next'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ProjectsView } from '@/components/projects/ProjectsView'

export const metadata: Metadata = { title: 'Projects' }

export default async function ProjectsPage() {
  const session = await getSession()
  if (!session) return null
  const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(session.user.role)

  const projects = await prisma.project.findMany({
    where: {
      isArchived: false,
      ...(!isAdmin ? {
        OR: [
          { ownerId: session.user.id },
          { members: { some: { userId: session.user.id } } },
        ],
      } : {}),
    },
    include: {
      owner: { select: { id: true, name: true, avatarUrl: true, avatarColor: true } },
      _count: { select: { issues: true, members: true, sprints: true } },
      members: {
        take: 5,
        include: { user: { select: { id: true, name: true, avatarUrl: true, avatarColor: true } } },
      },
      sprints: {
        where: { status: 'ACTIVE' },
        take: 1,
        select: { id: true, name: true, status: true },
      },
    },
    orderBy: { updatedAt: 'desc' },
  })

  const allUsers = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, name: true, email: true, avatarUrl: true, avatarColor: true },
    orderBy: { name: 'asc' },
  })

  return <ProjectsView projects={projects} users={allUsers} session={session} />
}
