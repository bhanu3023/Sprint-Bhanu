import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthSession, getProjectRole, ok, created, badRequest, unauthorized, forbidden, notFound, serverError } from '@/lib/api-helpers'
import { createSprintSchema } from '@/lib/validations/sprint.schema'
import { writeAuditLog } from '@/lib/audit'

export async function GET(req: NextRequest) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const { searchParams } = new URL(req.url)
    const projectKey = searchParams.get('projectKey')
    if (!projectKey) return badRequest('projectKey is required')

    const project = await prisma.project.findUnique({ where: { key: projectKey } })
    if (!project) return notFound('Project')

    const sprints = await prisma.sprint.findMany({
      where: { projectId: project.id },
      include: {
        _count: { select: { issues: true } },
      },
      orderBy: { order: 'asc' },
    })

    return ok(sprints)
  } catch (e) {
    return serverError(e)
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const body = await req.json()
    const parsed = createSprintSchema.safeParse(body)
    if (!parsed.success) return badRequest('Validation failed', parsed.error.errors)

    const project = await prisma.project.findUnique({ where: { key: parsed.data.projectKey } })
    if (!project) return notFound('Project')

    const projectRole = await getProjectRole(parsed.data.projectKey, session.user.id)
    const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(session.user.role)
    const canCreate = isAdmin || ['OWNER', 'ADMIN', 'SCRUM_MASTER'].includes(projectRole ?? '')
    if (!canCreate) return forbidden()

    const maxOrder = await prisma.sprint.aggregate({
      where: { projectId: project.id },
      _max: { order: true },
    })

    const sprint = await prisma.sprint.create({
      data: {
        projectId: project.id,
        name: parsed.data.name,
        goal: parsed.data.goal,
        startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : null,
        endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : null,
        order: (maxOrder._max.order ?? 0) + 1,
      },
      include: { _count: { select: { issues: true } } },
    })

    await writeAuditLog({
      actorId: session.user.id,
      projectId: project.id,
      entityType: 'Sprint',
      entityId: sprint.id,
      action: 'created',
      changes: { name: sprint.name },
    })

    return created(sprint)
  } catch (e) {
    return serverError(e)
  }
}
