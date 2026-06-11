import type { Metadata } from 'next'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ProfileView } from '@/components/profile/ProfileView'

export const metadata: Metadata = { title: 'My Profile' }

export default async function ProfilePage() {
  const session = await getSession()
  if (!session) return null

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: {
      projectMembers: {
        include: { project: { select: { id: true, key: true, name: true, avatarColor: true } } },
      },
      assignedIssues: {
        where: { status: { category: { not: 'DONE' } } },
        include: { status: true, project: { select: { key: true, name: true } } },
        orderBy: { updatedAt: 'desc' },
        take: 10,
      },
    },
  })
  if (!user) return null

  return <ProfileView user={user} currentUserId={session.user.id} />
}
