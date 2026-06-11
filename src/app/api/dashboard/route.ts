import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthSession, ok, unauthorized, serverError } from '@/lib/api-helpers'

export async function GET(_req: NextRequest) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(session.user.role)

    const projectFilter = isAdmin ? {} : {
      OR: [
        { ownerId: session.user.id },
        { members: { some: { userId: session.user.id } } },
      ],
    }

    const [
      totalProjects,
      activeSprints,
      myOpenIssues,
      myInProgressIssues,
      recentActivity,
      projectsWithStats,
    ] = await Promise.all([
      prisma.project.count({ where: { ...projectFilter, isArchived: false } }),
      prisma.sprint.count({
        where: { status: 'ACTIVE', project: projectFilter },
      }),
      prisma.issue.count({
        where: {
          assigneeId: session.user.id,
          status: { category: 'TODO' },
        },
      }),
      prisma.issue.count({
        where: {
          assigneeId: session.user.id,
          status: { category: 'IN_PROGRESS' },
        },
      }),
      prisma.auditLog.findMany({
        where: {
          OR: [
            { project: projectFilter },
            { actorId: session.user.id },
          ],
        },
        include: {
          actor: { select: { id: true, name: true, avatarUrl: true, avatarColor: true } },
          project: { select: { id: true, key: true, name: true } },
          issue: { select: { id: true, key: true, title: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 15,
      }),
      prisma.project.findMany({
        where: { ...projectFilter, isArchived: false },
        include: {
          _count: {
            select: { issues: true, members: true },
          },
          sprints: {
            where: { status: 'ACTIVE' },
            take: 1,
            select: { id: true, name: true, endDate: true, _count: { select: { issues: true } } },
          },
          members: {
            take: 4,
            include: { user: { select: { id: true, name: true, avatarUrl: true, avatarColor: true } } },
          },
        },
        orderBy: { updatedAt: 'desc' },
        take: 6,
      }),
    ])

    const myIssues = await prisma.issue.findMany({
      where: { assigneeId: session.user.id, status: { category: { not: 'DONE' } } },
      include: {
        status: true,
        project: { select: { id: true, key: true, name: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 10,
    })

    return ok({
      stats: {
        totalProjects,
        activeSprints,
        myOpenIssues,
        myInProgressIssues,
      },
      recentActivity,
      projects: projectsWithStats,
      myIssues,
    })
  } catch (e) {
    return serverError(e)
  }
}
