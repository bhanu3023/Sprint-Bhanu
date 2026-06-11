import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthSession, ok, created, badRequest, unauthorized, forbidden, notFound, serverError, noContent } from '@/lib/api-helpers'
import { createCommentSchema, updateCommentSchema } from '@/lib/validations/issue.schema'
import { writeAuditLog } from '@/lib/audit'
import { notifyCommentAdded } from '@/lib/notifications'

type Params = { params: { issueKey: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const issue = await prisma.issue.findUnique({ where: { key: params.issueKey } })
    if (!issue) return notFound('Issue')

    const comments = await prisma.comment.findMany({
      where: { issueId: issue.id },
      include: {
        author: { select: { id: true, name: true, avatarUrl: true, avatarColor: true } },
      },
      orderBy: { createdAt: 'asc' },
    })

    return ok(comments)
  } catch (e) {
    return serverError(e)
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const issue = await prisma.issue.findUnique({
      where: { key: params.issueKey },
      include: {
        project: true,
        watchers: true,
      },
    })
    if (!issue) return notFound('Issue')

    const body = await req.json()
    const parsed = createCommentSchema.safeParse(body)
    if (!parsed.success) return badRequest('Validation failed', parsed.error.errors)

    const comment = await prisma.comment.create({
      data: {
        issueId: issue.id,
        authorId: session.user.id,
        body: parsed.data.body,
      },
      include: {
        author: { select: { id: true, name: true, avatarUrl: true, avatarColor: true } },
      },
    })

    await writeAuditLog({
      actorId: session.user.id,
      projectId: issue.projectId,
      issueId: issue.id,
      entityType: 'Comment',
      entityId: comment.id,
      action: 'created',
    })

    // Notify watchers (except comment author)
    const watcherIds = issue.watchers
      .map((w) => w.userId)
      .filter((id) => id !== session.user.id)

    if (watcherIds.length > 0) {
      await notifyCommentAdded(
        watcherIds,
        session.user.name,
        issue.key,
        issue.project.key,
        parsed.data.body,
      )
    }

    return created(comment)
  } catch (e) {
    return serverError(e)
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const issue = await prisma.issue.findUnique({ where: { key: params.issueKey } })
    if (!issue) return notFound('Issue')

    const body = await req.json()
    const { commentId, ...rest } = body
    if (!commentId) return badRequest('commentId is required')

    const comment = await prisma.comment.findUnique({ where: { id: commentId } })
    if (!comment) return notFound('Comment')
    if (comment.authorId !== session.user.id) return forbidden()

    const parsed = updateCommentSchema.safeParse(rest)
    if (!parsed.success) return badRequest('Validation failed', parsed.error.errors)

    const updated = await prisma.comment.update({
      where: { id: commentId },
      data: { body: parsed.data.body, isEdited: true },
      include: {
        author: { select: { id: true, name: true, avatarUrl: true, avatarColor: true } },
      },
    })

    return ok(updated)
  } catch (e) {
    return serverError(e)
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const { searchParams } = new URL(req.url)
    const commentId = searchParams.get('commentId')
    if (!commentId) return badRequest('commentId is required')

    const comment = await prisma.comment.findUnique({ where: { id: commentId } })
    if (!comment) return notFound('Comment')

    const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(session.user.role)
    if (!isAdmin && comment.authorId !== session.user.id) return forbidden()

    await prisma.comment.delete({ where: { id: commentId } })

    return noContent()
  } catch (e) {
    return serverError(e)
  }
}
