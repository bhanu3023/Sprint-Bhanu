import type { Metadata } from 'next'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { notFound } from 'next/navigation'
import { IssuesListView } from '@/components/issues/IssuesListView'
import { ALL_FILTER_FIELDS } from '@/lib/field-definitions'

export const metadata: Metadata = { title: 'Issues' }

export default async function IssuesPage({ params }: { params: { projectKey: string } }) {
  const session = await getSession()
  if (!session) return null

  const project = await prisma.project.findUnique({
    where: { key: params.projectKey },
    include: {
      members: { include: { user: { select: { id: true, name: true, avatarUrl: true, avatarColor: true } } } },
      workflowStatuses: { orderBy: { order: 'asc' } },
      labels: { orderBy: { name: 'asc' } },
      sprints: { where: { status: { not: 'COMPLETED' } }, orderBy: { order: 'asc' } },
      projectFields: { orderBy: { order: 'asc' } },
    },
  })
  if (!project) notFound()

  const issues = await prisma.issue.findMany({
    where: { projectId: project.id, parentId: null },
    include: {
      status: true,
      assignee: { select: { id: true, name: true, avatarUrl: true, avatarColor: true } },
      reporter: { select: { id: true, name: true, avatarUrl: true, avatarColor: true } },
      labels: { include: { label: true } },
      sprint: { select: { id: true, name: true } },
      _count: { select: { subtasks: true, comments: true } },
    },
    orderBy: [{ sprintId: 'asc' }, { order: 'asc' }],
    take: 100,
  })

  // Resolve enabled fields: if none configured, all fields are enabled
  const fieldMap = new Map(project.projectFields.map((f) => [f.fieldKey, f]))
  const enabledFields = ALL_FILTER_FIELDS.filter((f) =>
    project.projectFields.length === 0 ? true : (fieldMap.get(f.key)?.isEnabled ?? false)
  ).map((f) => {
    const stored = fieldMap.get(f.key)
    return { ...f, order: stored?.order ?? 0 }
  }).sort((a, b) => a.order - b.order)

  return (
    <IssuesListView
      project={project}
      initialIssues={issues}
      members={project.members.map((m) => m.user)}
      labels={project.labels}
      statuses={project.workflowStatuses}
      sprints={project.sprints}
      enabledFields={enabledFields}
    />
  )
}
