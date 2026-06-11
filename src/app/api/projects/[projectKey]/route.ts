import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthSession, getProjectRole, ok, notFound, unauthorized, forbidden, serverError, noContent, badRequest } from '@/lib/api-helpers'
import { updateProjectSchema } from '@/lib/validations/project.schema'
import { writeAuditLog } from '@/lib/audit'

type Params = { params: { projectKey: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const project = await prisma.project.findUnique({
      where: { key: params.projectKey },
      include: {
        owner: { select: { id: true, name: true, email: true, avatarUrl: true, avatarColor: true } },
        members: {
          include: { user: { select: { id: true, name: true, email: true, avatarUrl: true, avatarColor: true } } },
          orderBy: { joinedAt: 'asc' },
        },
        columns: {
          include: { status: true },
          orderBy: { order: 'asc' },
        },
        workflowStatuses: { orderBy: { order: 'asc' } },
        workflowTransitions: {
          include: { fromStatus: true, toStatus: true },
        },
        labels: { orderBy: { name: 'asc' } },
        _count: { select: { issues: true, members: true, sprints: true } },
      },
    })

    if (!project) return notFound('Project')

    // Check access
    const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(session.user.role)
    const isMember = project.members.some((m) => m.userId === session.user.id)
    if (!isAdmin && !isMember) return forbidden()

    return ok(project)
  } catch (e) {
    return serverError(e)
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const projectRole = await getProjectRole(params.projectKey, session.user.id)
    const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(session.user.role)
    const canEdit = isAdmin || ['OWNER', 'ADMIN'].includes(projectRole ?? '')
    if (!canEdit) return forbidden()

    const body = await req.json()
    const parsed = updateProjectSchema.safeParse(body)
    if (!parsed.success) return badRequest('Validation failed', parsed.error.errors)

    const project = await prisma.project.update({
      where: { key: params.projectKey },
      data: parsed.data,
    })

    await writeAuditLog({
      actorId: session.user.id,
      projectId: project.id,
      entityType: 'Project',
      entityId: project.id,
      action: 'updated',
      changes: parsed.data,
    })

    return ok(project)
  } catch (e) {
    return serverError(e)
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(session.user.role)
    const projectRole = await getProjectRole(params.projectKey, session.user.id)
    const canDelete = isAdmin || projectRole === 'OWNER'
    if (!canDelete) return forbidden()

    const project = await prisma.project.findUnique({ where: { key: params.projectKey } })
    if (!project) return notFound('Project')

    await prisma.project.delete({ where: { key: params.projectKey } })

    return noContent()
  } catch (e) {
    return serverError(e)
  }
}
