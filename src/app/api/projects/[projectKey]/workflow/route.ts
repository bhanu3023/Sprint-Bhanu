import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthSession, getProjectRole, ok, created, badRequest, unauthorized, forbidden, notFound, serverError } from '@/lib/api-helpers'

export async function GET(_req: NextRequest, { params }: { params: { projectKey: string } }) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const project = await prisma.project.findUnique({ where: { key: params.projectKey } })
    if (!project) return notFound()

    const [statuses, transitions] = await Promise.all([
      prisma.workflowStatus.findMany({ where: { projectId: project.id }, orderBy: { order: 'asc' } }),
      prisma.workflowTransition.findMany({ where: { projectId: project.id }, include: { fromStatus: true, toStatus: true } }),
    ])
    return ok({ statuses, transitions })
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
    if (!role || !['OWNER', 'ADMIN'].includes(role)) return forbidden()

    const body = await req.json()
    const { type, ...data } = body

    if (type === 'status') {
      const { name, color, category } = data
      if (!name || !color || !category) return badRequest('name, color, category required')
      const maxOrder = await prisma.workflowStatus.aggregate({ where: { projectId: project.id }, _max: { order: true } })
      const status = await prisma.workflowStatus.create({
        data: { name, color, category, projectId: project.id, order: (maxOrder._max.order ?? 0) + 1 },
      })
      return created(status)
    }

    if (type === 'transition') {
      const { fromStatusId, toStatusId, name, requiredRole } = data
      if (!fromStatusId || !toStatusId) return badRequest('fromStatusId and toStatusId required')
      const existing = await prisma.workflowTransition.findFirst({ where: { projectId: project.id, fromStatusId, toStatusId } })
      if (existing) return badRequest('Transition already exists')
      const transition = await prisma.workflowTransition.create({
        data: { projectId: project.id, fromStatusId, toStatusId, name: name ?? null, requiredRole: requiredRole ?? null },
        include: { fromStatus: true, toStatus: true },
      })
      return created(transition)
    }

    return badRequest('type must be "status" or "transition"')
  } catch (e) {
    return serverError(e)
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { projectKey: string } }) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const project = await prisma.project.findUnique({ where: { key: params.projectKey } })
    if (!project) return notFound()

    const role = await getProjectRole(params.projectKey, session.user.id)
    if (!role || !['OWNER', 'ADMIN'].includes(role)) return forbidden()

    const { searchParams } = new URL(req.url)
    const statusId = searchParams.get('statusId')
    const transitionId = searchParams.get('transitionId')

    if (statusId) {
      const inUse = await prisma.issue.count({ where: { projectId: project.id, statusId } })
      if (inUse > 0) return badRequest(`Cannot delete status: ${inUse} issues use it`)
      await prisma.workflowTransition.deleteMany({ where: { projectId: project.id, OR: [{ fromStatusId: statusId }, { toStatusId: statusId }] } })
      await prisma.workflowStatus.delete({ where: { id: statusId } })
      return ok({ deleted: statusId })
    }

    if (transitionId) {
      await prisma.workflowTransition.delete({ where: { id: transitionId } })
      return ok({ deleted: transitionId })
    }

    return badRequest('statusId or transitionId required')
  } catch (e) {
    return serverError(e)
  }
}
