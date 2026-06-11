import type { Metadata } from 'next'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { notFound, redirect } from 'next/navigation'
import { ProjectSettingsView } from '@/components/projects/ProjectSettingsView'

export const metadata: Metadata = { title: 'Project Settings' }

export default async function ProjectSettingsPage({ params }: { params: { projectKey: string } }) {
  const session = await getSession()
  if (!session) return null

  const project = await prisma.project.findUnique({
    where: { key: params.projectKey },
    include: {
      owner: { select: { id: true, name: true } },
      members: {
        include: { user: { select: { id: true, name: true, email: true, avatarUrl: true, avatarColor: true, isActive: true } } },
        orderBy: { joinedAt: 'asc' },
      },
      columns: { include: { status: true }, orderBy: { order: 'asc' } },
      workflowStatuses: { orderBy: { order: 'asc' } },
      workflowTransitions: { include: { fromStatus: true, toStatus: true } },
      labels: { orderBy: { name: 'asc' } },
      projectFields: { orderBy: { order: 'asc' } },
    },
  })

  if (!project) notFound()

  const projectRole = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId: project.id, userId: session.user.id } },
    select: { role: true },
  })

  const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(session.user.role)
  const canManage = isAdmin || ['OWNER', 'ADMIN'].includes(projectRole?.role ?? '')
  if (!canManage) redirect(`/projects/${params.projectKey}/board`)

  const allUsers = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, name: true, email: true, avatarUrl: true, avatarColor: true },
    orderBy: { name: 'asc' },
  })

  return <ProjectSettingsView project={project} allUsers={allUsers} isAdmin={isAdmin} />
}
