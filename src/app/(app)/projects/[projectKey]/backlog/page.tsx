import type { Metadata } from 'next'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { notFound } from 'next/navigation'
import { BacklogView } from '@/components/backlog/BacklogView'

export async function generateMetadata({ params }: { params: { projectKey: string } }) {
  const p = await prisma.project.findUnique({ where: { key: params.projectKey }, select: { name: true } })
  return { title: p ? `${p.name} · Backlog` : 'Backlog' }
}

export default async function BacklogPage({ params }: { params: { projectKey: string } }) {
  const session = await getSession()
  if (!session) return null

  const project = await prisma.project.findUnique({
    where: { key: params.projectKey },
    include: {
      members: { include: { user: { select: { id: true, name: true, avatarUrl: true, avatarColor: true } } } },
      labels: { orderBy: { name: 'asc' } },
      workflowStatuses: { orderBy: { order: 'asc' } },
    },
  })
  if (!project) notFound()

  const sprints = await prisma.sprint.findMany({
    where: { projectId: project.id, status: { not: 'COMPLETED' } },
    include: {
      issues: {
        include: {
          status: true,
          assignee: { select: { id: true, name: true, avatarUrl: true, avatarColor: true } },
          labels: { include: { label: true } },
          _count: { select: { subtasks: true, comments: true } },
        },
        orderBy: { order: 'asc' },
        where: { parentId: null },
      },
      _count: { select: { issues: true } },
    },
    orderBy: { order: 'asc' },
  })

  const backlogIssues = await prisma.issue.findMany({
    where: { projectId: project.id, sprintId: null, parentId: null },
    include: {
      status: true,
      assignee: { select: { id: true, name: true, avatarUrl: true, avatarColor: true } },
      labels: { include: { label: true } },
      _count: { select: { subtasks: true, comments: true } },
    },
    orderBy: { order: 'asc' },
  })

  const projectRole = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId: project.id, userId: session.user.id } },
    select: { role: true },
  })

  return (
    <BacklogView
      project={project}
      initialSprints={sprints}
      initialBacklogIssues={backlogIssues}
      members={project.members.map((m) => m.user)}
      labels={project.labels}
      workflowStatuses={project.workflowStatuses}
      currentUserId={session.user.id}
      projectRole={projectRole?.role ?? null}
      isAdmin={['SUPER_ADMIN', 'ADMIN'].includes(session.user.role)}
    />
  )
}
