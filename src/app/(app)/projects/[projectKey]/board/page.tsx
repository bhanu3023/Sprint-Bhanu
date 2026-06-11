import type { Metadata } from 'next'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { notFound } from 'next/navigation'
import { BoardView } from '@/components/board/BoardView'

export async function generateMetadata({ params }: { params: { projectKey: string } }) {
  const project = await prisma.project.findUnique({
    where: { key: params.projectKey },
    select: { name: true },
  })
  return { title: project ? `${project.name} Board` : 'Board' }
}

export default async function BoardPage({ params }: { params: { projectKey: string } }) {
  const session = await getSession()
  if (!session) return null

  const project = await prisma.project.findUnique({
    where: { key: params.projectKey },
    include: {
      members: {
        include: { user: { select: { id: true, name: true, avatarUrl: true, avatarColor: true } } },
      },
      columns: {
        include: { status: true },
        orderBy: { order: 'asc' },
      },
      sprints: {
        where: { status: { in: ['ACTIVE', 'PLANNED'] } },
        orderBy: { order: 'asc' },
      },
      workflowStatuses: { orderBy: { order: 'asc' } },
      workflowTransitions: {
        include: { fromStatus: true, toStatus: true },
      },
      labels: { orderBy: { name: 'asc' } },
    },
  })

  if (!project) notFound()

  // Get active sprint
  const activeSprint = project.sprints.find((s) => s.status === 'ACTIVE') ?? null

  // Get board state
  const columns = await prisma.boardColumn.findMany({
    where: { projectId: project.id },
    include: {
      status: true,
      issues: {
        where: activeSprint ? { sprintId: activeSprint.id } : { id: 'none' }, // empty if no sprint
        include: {
          status: true,
          assignee: { select: { id: true, name: true, avatarUrl: true, avatarColor: true } },
          reporter: { select: { id: true, name: true, avatarUrl: true, avatarColor: true } },
          labels: { include: { label: true } },
          _count: { select: { subtasks: true, comments: true } },
        },
        orderBy: { order: 'asc' },
      },
    },
    orderBy: { order: 'asc' },
  })

  const projectRole = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId: project.id, userId: session.user.id } },
    select: { role: true },
  })

  return (
    <BoardView
      project={project}
      initialColumns={columns}
      activeSprint={activeSprint}
      sprints={project.sprints}
      members={project.members.map((m) => m.user)}
      labels={project.labels}
      workflowStatuses={project.workflowStatuses}
      workflowTransitions={project.workflowTransitions}
      currentUserId={session.user.id}
      projectRole={projectRole?.role ?? null}
      isAdmin={['SUPER_ADMIN', 'ADMIN'].includes(session.user.role)}
    />
  )
}
