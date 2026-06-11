import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthSession, getProjectRole, ok, notFound, unauthorized, forbidden, serverError } from '@/lib/api-helpers'
import { ALL_FILTER_FIELDS } from '@/lib/field-definitions'

type Params = { params: { projectKey: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const project = await prisma.project.findUnique({
      where: { key: params.projectKey },
      include: { projectFields: { orderBy: { order: 'asc' } } },
    })
    if (!project) return notFound()

    const role = await getProjectRole(session.user.id, project.id)
    if (!role) return forbidden()

    // If no fields configured yet, return all fields as enabled
    if (project.projectFields.length === 0) {
      return ok(ALL_FILTER_FIELDS.map((f, i) => ({ ...f, isEnabled: true, order: i })))
    }

    const fieldMap = new Map(project.projectFields.map((f) => [f.fieldKey, f]))
    return ok(
      ALL_FILTER_FIELDS.map((f, i) => {
        const stored = fieldMap.get(f.key)
        return { ...f, isEnabled: stored?.isEnabled ?? true, order: stored?.order ?? i }
      }).sort((a, b) => a.order - b.order)
    )
  } catch (e) {
    return serverError(e)
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const project = await prisma.project.findUnique({ where: { key: params.projectKey } })
    if (!project) return notFound()

    const role = await getProjectRole(session.user.id, project.id)
    if (!role || role === 'VIEWER') return forbidden()

    const body: Array<{ key: string; isEnabled: boolean; order: number }> = await req.json()

    await prisma.$transaction(
      body.map((f) =>
        prisma.projectField.upsert({
          where: { projectId_fieldKey: { projectId: project.id, fieldKey: f.key } },
          create: { projectId: project.id, fieldKey: f.key, isEnabled: f.isEnabled, order: f.order },
          update: { isEnabled: f.isEnabled, order: f.order },
        })
      )
    )

    return ok({ success: true })
  } catch (e) {
    return serverError(e)
  }
}
