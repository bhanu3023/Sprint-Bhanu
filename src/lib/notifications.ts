import { prisma } from '@/lib/prisma'
import { NotifType } from '@prisma/client'

interface NotificationInput {
  userId: string
  type: NotifType
  title: string
  body: string
  link?: string
}

export async function createNotification(input: NotificationInput) {
  try {
    await prisma.notification.create({ data: input })
  } catch (e) {
    console.error('Failed to create notification:', e)
  }
}

export async function notifyIssueAssigned(
  assigneeId: string,
  issueKey: string,
  issueTitle: string,
  projectKey: string,
) {
  await createNotification({
    userId: assigneeId,
    type: 'ISSUE_ASSIGNED',
    title: 'Issue assigned to you',
    body: `${issueKey}: ${issueTitle} has been assigned to you`,
    link: `/projects/${projectKey}/issues/${issueKey}`,
  })
}

export async function notifyCommentAdded(
  watcherIds: string[],
  authorName: string,
  issueKey: string,
  projectKey: string,
  commentBody: string,
) {
  const body = `${authorName} commented on ${issueKey}: "${commentBody.slice(0, 80)}${commentBody.length > 80 ? '...' : ''}"`
  await Promise.all(
    watcherIds.map((userId) =>
      createNotification({
        userId,
        type: 'COMMENT_ADDED',
        title: `New comment on ${issueKey}`,
        body,
        link: `/projects/${projectKey}/issues/${issueKey}`,
      }),
    ),
  )
}

export async function notifySprintStarted(
  memberIds: string[],
  sprintName: string,
  projectKey: string,
) {
  await Promise.all(
    memberIds.map((userId) =>
      createNotification({
        userId,
        type: 'SPRINT_STARTED',
        title: 'Sprint started',
        body: `${sprintName} has been started`,
        link: `/projects/${projectKey}/board`,
      }),
    ),
  )
}

export async function notifySprintCompleted(
  memberIds: string[],
  sprintName: string,
  projectKey: string,
) {
  await Promise.all(
    memberIds.map((userId) =>
      createNotification({
        userId,
        type: 'SPRINT_COMPLETED',
        title: 'Sprint completed',
        body: `${sprintName} has been completed`,
        link: `/projects/${projectKey}/sprints`,
      }),
    ),
  )
}

export async function notifyStatusChanged(
  watcherIds: string[],
  issueKey: string,
  projectKey: string,
  fromStatus: string,
  toStatus: string,
) {
  await Promise.all(
    watcherIds.map((userId) =>
      createNotification({
        userId,
        type: 'STATUS_CHANGED',
        title: `${issueKey} status updated`,
        body: `Status changed from "${fromStatus}" to "${toStatus}"`,
        link: `/projects/${projectKey}/issues/${issueKey}`,
      }),
    ),
  )
}
