import type { Metadata } from 'next'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { NotificationsView } from '@/components/notifications/NotificationsView'

export const metadata: Metadata = { title: 'Notifications' }

export default async function NotificationsPage() {
  const session = await getSession()
  if (!session) return null

  const notifications = await prisma.notification.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })

  return <NotificationsView initialNotifications={notifications} />
}
