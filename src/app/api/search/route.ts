import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthSession, ok, unauthorized, badRequest, serverError } from '@/lib/api-helpers'

export async function GET(req: NextRequest) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const { searchParams } = new URL(req.url)
    const q = searchParams.get('q') || ''
    const type = searchParams.get('type') || 'all'

    if (!q || q.length < 2) return badRequest('Search query must be at least 2 characters')

    const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(session.user.role)

    const projectFilter = isAdmin ? {} : {
      OR: [
        { ownerId: session.user.id },
        { members: { some: { userId: session.user.id } } },
      ],
    }

    const results: Record<string, unknown[]> = {}

    if (type === 'all' || type === 'issue') {
      results.issues = await prisma.issue.findMany({
        where: {
          project: projectFilter,
          OR: [
            { title: { contains: q, mode: 'insensitive' } },
            { key: { contains: q, mode: 'insensitive' } },
          ],
        },
        include: {
          status: true,
          project: { select: { id: true, key: true, name: true } },
          assignee: { select: { id: true, name: true, avatarUrl: true, avatarColor: true } },
        },
        take: 10,
      })
    }

    if (type === 'all' || type === 'project') {
      results.projects = await prisma.project.findMany({
        where: {
          ...projectFilter,
          name: { contains: q, mode: 'insensitive' },
        },
        select: { id: true, key: true, name: true, avatarColor: true },
        take: 5,
      })
    }

    if (type === 'all' || type === 'user') {
      results.users = await prisma.user.findMany({
        where: {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
          ],
        },
        select: { id: true, name: true, email: true, avatarUrl: true, avatarColor: true },
        take: 5,
      })
    }

    return ok(results)
  } catch (e) {
    return serverError(e)
  }
}
