import type { Metadata } from 'next'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { notFound } from 'next/navigation'
import { IssueDetailPage } from '@/components/issues/IssueDetailPage'

export async function generateMetadata({ params }: { params: { issueKey: string } }) {
  const issue = await prisma.issue.findUnique({ where: { key: params.issueKey }, select: { title: true, key: true } })
  return { title: issue ? `${issue.key}: ${issue.title}` : 'Issue' }
}

export default async function IssueDetailPageRoute({ params }: { params: { projectKey: string; issueKey: string } }) {
  const session = await getSession()
  if (!session) return null

  const issue = await prisma.issue.findUnique({
    where: { key: params.issueKey },
    include: {
      status: true,
      column: { include: { status: true } },
      sprint: true,
      assignee: { select: { id: true, name: true, email: true, avatarUrl: true, avatarColor: true } },
      reporter: { select: { id: true, name: true, email: true, avatarUrl: true, avatarColor: true } },
      labels: { include: { label: true } },
      parent: { select: { id: true, key: true, title: true, type: true } },
      subtasks: {
        include: {
          status: true,
          assignee: { select: { id: true, name: true, avatarUrl: true, avatarColor: true } },
        },
        orderBy: { order: 'asc' },
      },
      epic: { select: { id: true, key: true, title: true } },
      comments: {
        include: { author: { select: { id: true, name: true, avatarUrl: true, avatarColor: true } } },
        orderBy: { createdAt: 'asc' },
      },
      attachments: {
        include: { uploader: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
      },
      watchers: {
        include: { user: { select: { id: true, name: true, avatarUrl: true, avatarColor: true } } },
      },
      project: {
        select: {
          id: true, key: true, name: true,
          workflowTransitions: { include: { fromStatus: true, toStatus: true } },
        },
      },
    },
  })

  if (!issue) notFound()

  const activityLogs = await prisma.auditLog.findMany({
    where: { issueId: issue.id },
    include: { actor: { select: { id: true, name: true, avatarColor: true } } },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })

  const projectMembers = await prisma.projectMember.findMany({
    where: { projectId: issue.projectId },
    include: { user: { select: { id: true, name: true, email: true, avatarUrl: true, avatarColor: true } } },
  })

  const labels = await prisma.label.findMany({
    where: { projectId: issue.projectId },
    orderBy: { name: 'asc' },
  })

  const projectRole = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId: issue.projectId, userId: session.user.id } },
    select: { role: true },
  })

  const canEdit = ['SUPER_ADMIN', 'ADMIN'].includes(session.user.role) ||
    (projectRole?.role !== 'VIEWER' && projectRole !== null)

  return (
    <IssueDetailPage
      issue={issue}
      activityLogs={activityLogs}
      members={projectMembers.map((m) => m.user)}
      labels={labels}
      currentUserId={session.user.id}
      canEdit={canEdit}
    />
  )
}
