import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthSession, getProjectRole, ok, badRequest, unauthorized, forbidden, notFound, serverError } from '@/lib/api-helpers'
import { z } from 'zod'

type Params = { params: { projectKey: string } }

const moveSchema = z.object({
  issueIds: z.array(z.string().cuid()).min(1),
  targetSprintId: z.string().cuid().nullable(),
})

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const project = await prisma.project.findUnique({ where: { key: params.projectKey } })
    if (!project) return notFound('Project')

    const projectRole = await getProjectRole(params.projectKey, session.user.id)
    const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(session.user.role)
    if (!isAdmin && projectRole === 'VIEWER') return forbidden()

    const body = await req.json()
    const parsed = moveSchema.safeParse(body)
    if (!parsed.success) return badRequest('Validation failed', parsed.error.errors)

    if (parsed.data.targetSprintId) {
      const sprint = await prisma.sprint.findUnique({ where: { id: parsed.data.targetSprintId } })
      if (!sprint) return notFound('Sprint')
      if (sprint.projectId !== project.id) return badRequest('Sprint does not belong to this project')
    }

    await prisma.issue.updateMany({
      where: { id: { in: parsed.data.issueIds }, projectId: project.id },
      data: { sprintId: parsed.data.targetSprintId },
    })

    return ok({ moved: parsed.data.issueIds.length })
  } catch (e) {
    return serverError(e)
  }
}
