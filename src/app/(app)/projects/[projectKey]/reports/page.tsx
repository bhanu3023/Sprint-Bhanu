import type { Metadata } from 'next'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { notFound } from 'next/navigation'
import { ReportsView } from '@/components/reports/ReportsView'

export async function generateMetadata({ params }: { params: { projectKey: string } }) {
  const p = await prisma.project.findUnique({ where: { key: params.projectKey }, select: { name: true } })
  return { title: p ? `${p.name} · Reports` : 'Reports' }
}

export default async function ReportsPage({ params }: { params: { projectKey: string } }) {
  const session = await getSession()
  if (!session) return null

  const project = await prisma.project.findUnique({ where: { key: params.projectKey } })
  if (!project) notFound()

  const sprints = await prisma.sprint.findMany({
    where: { projectId: project.id },
    orderBy: { order: 'desc' },
    take: 10,
  })

  const issuesByStatus = await prisma.workflowStatus.findMany({
    where: { projectId: project.id },
    include: { _count: { select: { issues: true } } },
    orderBy: { order: 'asc' },
  })

  const issuesByType = await prisma.issue.groupBy({
    by: ['type'],
    where: { projectId: project.id },
    _count: { _all: true },
  })

  const issuesByPriority = await prisma.issue.groupBy({
    by: ['priority'],
    where: { projectId: project.id },
    _count: { _all: true },
  })

  const members = await prisma.projectMember.findMany({
    where: { projectId: project.id },
    include: {
      user: { select: { id: true, name: true, avatarUrl: true, avatarColor: true } },
    },
  })

  const assigneeStats = await prisma.user.findMany({
    where: { assignedIssues: { some: { projectId: project.id } } },
    select: {
      id: true, name: true, avatarColor: true,
      _count: { select: { assignedIssues: { where: { projectId: project.id } } } },
    },
    take: 10,
  })

  return (
    <ReportsView
      project={project}
      sprints={sprints}
      issuesByStatus={issuesByStatus}
      issuesByType={issuesByType}
      issuesByPriority={issuesByPriority}
      assigneeStats={assigneeStats}
    />
  )
}
