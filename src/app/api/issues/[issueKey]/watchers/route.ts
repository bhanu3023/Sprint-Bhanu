import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthSession, ok, noContent, unauthorized, notFound, serverError } from '@/lib/api-helpers'

export async function GET(_req: NextRequest, { params }: { params: { issueKey: string } }) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const issue = await prisma.issue.findUnique({
      where: { key: params.issueKey },
      include: { watchers: { include: { user: { select: { id: true, name: true, avatarUrl: true, avatarColor: true } } } } },
    })
    if (!issue) return notFound()
    return ok(issue.watchers.map((w) => w.user))
  } catch (e) {
    return serverError(e)
  }
}

export async function POST(_req: NextRequest, { params }: { params: { issueKey: string } }) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const issue = await prisma.issue.findUnique({ where: { key: params.issueKey } })
    if (!issue) return notFound()

    await prisma.issueWatcher.upsert({
      where: { issueId_userId: { issueId: issue.id, userId: session.user.id } },
      create: { issueId: issue.id, userId: session.user.id },
      update: {},
    })
    return ok({ watching: true })
  } catch (e) {
    return serverError(e)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { issueKey: string } }) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const issue = await prisma.issue.findUnique({ where: { key: params.issueKey } })
    if (!issue) return notFound()

    await prisma.issueWatcher.deleteMany({
      where: { issueId: issue.id, userId: session.user.id },
    })
    return noContent()
  } catch (e) {
    return serverError(e)
  }
}
