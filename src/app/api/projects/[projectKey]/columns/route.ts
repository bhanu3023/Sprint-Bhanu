import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthSession, getProjectRole, ok, badRequest, unauthorized, forbidden, notFound, serverError } from '@/lib/api-helpers'

export async function GET(_req: NextRequest, { params }: { params: { projectKey: string } }) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const project = await prisma.project.findUnique({ where: { key: params.projectKey } })
    if (!project) return notFound()

    const columns = await prisma.boardColumn.findMany({
      where: { projectId: project.id },
      include: { status: true },
      orderBy: { order: 'asc' },
    })
    return ok(columns)
  } catch (e) {
    return serverError(e)
  }
}

export async function POST(req: NextRequest, { params }: { params: { projectKey: string } }) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const project = await prisma.project.findUnique({ where: { key: params.projectKey } })
    if (!project) return notFound()

    const role = await getProjectRole(params.projectKey, session.user.id)
    if (!role || !['OWNER', 'ADMIN', 'SCRUM_MASTER'].includes(role)) return forbidden()

    const body = await req.json()
    const { name, statusId, wipLimit } = body
    if (!name || !statusId) return badRequest('name and statusId required')

    const maxOrder = await prisma.boardColumn.aggregate({ where: { projectId: project.id }, _max: { order: true } })
    const order = (maxOrder._max.order ?? 0) + 1

    const column = await prisma.boardColumn.create({
      data: { name, projectId: project.id, statusId, order, wipLimit: wipLimit ?? null },
      include: { status: true },
    })
    return ok(column)
  } catch (e) {
    return serverError(e)
  }
}

export async function PUT(req: NextRequest, { params }: { params: { projectKey: string } }) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const project = await prisma.project.findUnique({ where: { key: params.projectKey } })
    if (!project) return notFound()

    const role = await getProjectRole(params.projectKey, session.user.id)
    if (!role || !['OWNER', 'ADMIN', 'SCRUM_MASTER'].includes(role)) return forbidden()

    const body = await req.json()
    // Expects array of { id, order, name, wipLimit }
    const updates: Array<{ id: string; order: number; name?: string; wipLimit?: number | null }> = body
    if (!Array.isArray(updates)) return badRequest('Expected array of column updates')

    await Promise.all(updates.map((u) =>
      prisma.boardColumn.update({
        where: { id: u.id },
        data: { order: u.order, ...(u.name && { name: u.name }), wipLimit: u.wipLimit },
      })
    ))

    const columns = await prisma.boardColumn.findMany({
      where: { projectId: project.id },
      include: { status: true },
      orderBy: { order: 'asc' },
    })
    return ok(columns)
  } catch (e) {
    return serverError(e)
  }
}
