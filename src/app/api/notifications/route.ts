import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthSession, ok, unauthorized, serverError, noContent } from '@/lib/api-helpers'

export async function GET(req: NextRequest) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const { searchParams } = new URL(req.url)
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = parseInt(searchParams.get('pageSize') || '20')
    const unreadOnly = searchParams.get('unreadOnly') === 'true'

    const where = {
      userId: session.user.id,
      ...(unreadOnly ? { isRead: false } : {}),
    }

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { userId: session.user.id, isRead: false } }),
    ])

    return ok({ notifications, total, unreadCount, page, pageSize })
  } catch (e) {
    return serverError(e)
  }
}

export async function PATCH() {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    await prisma.notification.updateMany({
      where: { userId: session.user.id, isRead: false },
      data: { isRead: true },
    })

    return ok({ marked: true })
  } catch (e) {
    return serverError(e)
  }
}

export async function DELETE() {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    await prisma.notification.deleteMany({ where: { userId: session.user.id } })
    return noContent()
  } catch (e) {
    return serverError(e)
  }
}
