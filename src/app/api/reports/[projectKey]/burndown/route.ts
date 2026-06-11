import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthSession, ok, unauthorized, notFound, badRequest, serverError } from '@/lib/api-helpers'
import { eachDayOfInterval, format, isBefore, isAfter } from 'date-fns'

type Params = { params: { projectKey: string } }

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const { searchParams } = new URL(req.url)
    const sprintId = searchParams.get('sprintId')
    if (!sprintId) return badRequest('sprintId is required')

    const project = await prisma.project.findUnique({ where: { key: params.projectKey } })
    if (!project) return notFound('Project')

    const sprint = await prisma.sprint.findUnique({ where: { id: sprintId } })
    if (!sprint || sprint.projectId !== project.id) return notFound('Sprint')
    if (!sprint.startDate || !sprint.endDate) return badRequest('Sprint has no dates set')

    const issues = await prisma.issue.findMany({
      where: { sprintId: sprint.id },
      select: {
        id: true, storyPoints: true, statusId: true,
        status: { select: { category: true } },
        createdAt: true, updatedAt: true,
      },
    })

    const totalPoints = issues.reduce((sum, i) => sum + (i.storyPoints ?? 1), 0)
    const days = eachDayOfInterval({ start: sprint.startDate, end: sprint.endDate })

    // Build ideal burndown line
    const pointsPerDay = totalPoints / (days.length - 1)
    const idealData = days.map((day, idx) => ({
      date: format(day, 'MMM d'),
      ideal: Math.max(0, Math.round((totalPoints - pointsPerDay * idx) * 10) / 10),
    }))

    // Get audit logs to reconstruct daily completions
    const auditLogs = await prisma.auditLog.findMany({
      where: {
        issueId: { in: issues.map((i) => i.id) },
        action: 'transitioned',
        createdAt: { gte: sprint.startDate, lte: sprint.endDate },
      },
      orderBy: { createdAt: 'asc' },
    })

    // Build actual burndown
    const doneIssuesByDay: Record<string, number> = {}
    for (const log of auditLogs) {
      const changes = log.changes as Record<string, string> | null
      if (changes?.to === 'Done') {
        const day = format(log.createdAt, 'MMM d')
        const issue = issues.find((i) => i.id === log.issueId)
        doneIssuesByDay[day] = (doneIssuesByDay[day] ?? 0) + (issue?.storyPoints ?? 1)
      }
    }

    let remaining = totalPoints
    const now = new Date()
    const actualData = days.map((day) => {
      const isInFuture = isAfter(day, now)
      if (!isInFuture) {
        const dayKey = format(day, 'MMM d')
        remaining -= doneIssuesByDay[dayKey] ?? 0
        return { date: format(day, 'MMM d'), actual: Math.max(0, remaining) }
      }
      return { date: format(day, 'MMM d'), actual: null }
    })

    const data = idealData.map((d, i) => ({
      date: d.date,
      ideal: d.ideal,
      actual: actualData[i].actual,
    }))

    const completedPoints = issues
      .filter((i) => i.status.category === 'DONE')
      .reduce((sum, i) => sum + (i.storyPoints ?? 1), 0)

    return ok({
      data,
      summary: {
        totalPoints,
        completedPoints,
        remainingPoints: totalPoints - completedPoints,
        completionPercent: totalPoints > 0 ? Math.round((completedPoints / totalPoints) * 100) : 0,
        totalIssues: issues.length,
        completedIssues: issues.filter((i) => i.status.category === 'DONE').length,
      },
      sprint: { id: sprint.id, name: sprint.name, startDate: sprint.startDate, endDate: sprint.endDate },
    })
  } catch (e) {
    return serverError(e)
  }
}
