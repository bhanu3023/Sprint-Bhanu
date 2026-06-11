import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthSession, ok, noContent, unauthorized, forbidden, notFound, serverError } from '@/lib/api-helpers'

export async function PATCH(_req: NextRequest, { params }: { params: { notifId: string } }) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const notif = await prisma.notification.findUnique({ where: { id: params.notifId } })
    if (!notif) return notFound()
    if (notif.userId !== session.user.id) return forbidden()

    const updated = await prisma.notification.update({
      where: { id: params.notifId },
      data: { isRead: true },
    })
    return ok(updated)
  } catch (e) {
    return serverError(e)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { notifId: string } }) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const notif = await prisma.notification.findUnique({ where: { id: params.notifId } })
    if (!notif) return notFound()
    if (notif.userId !== session.user.id) return forbidden()

    await prisma.notification.delete({ where: { id: params.notifId } })
    return noContent()
  } catch (e) {
    return serverError(e)
  }
}
