import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthSession, ok, notFound, unauthorized, forbidden, serverError, badRequest } from '@/lib/api-helpers'
import { z } from 'zod'

const slaPolicySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  highestResponseHours: z.number().int().positive(),
  highResponseHours: z.number().int().positive(),
  mediumResponseHours: z.number().int().positive(),
  lowResponseHours: z.number().int().positive(),
  lowestResponseHours: z.number().int().positive(),
  highestResolutionHours: z.number().int().positive(),
  highResolutionHours: z.number().int().positive(),
  mediumResolutionHours: z.number().int().positive(),
  lowResolutionHours: z.number().int().positive(),
  lowestResolutionHours: z.number().int().positive(),
})

export async function GET(_req: NextRequest, { params }: { params: { projectKey: string } }) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const project = await prisma.project.findUnique({
      where: { key: params.projectKey },
      include: { slaPolicy: true },
    })
    if (!project) return notFound('Project')

    return ok(project.slaPolicy ?? null)
  } catch (e) {
    return serverError(e)
  }
}

export async function PUT(req: NextRequest, { params }: { params: { projectKey: string } }) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const project = await prisma.project.findUnique({
      where: { key: params.projectKey },
      include: {
        members: { where: { userId: session.user.id } },
      },
    })
    if (!project) return notFound('Project')

    const isGlobalAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(session.user.role)
    const projectRole = project.members[0]?.role
    const canManage = isGlobalAdmin || ['OWNER', 'ADMIN', 'SCRUM_MASTER'].includes(projectRole ?? '')
    if (!canManage) return forbidden()

    const body = await req.json()
    const parsed = slaPolicySchema.safeParse(body)
    if (!parsed.success) return badRequest('Validation failed', parsed.error.flatten().fieldErrors)

    const policy = await prisma.slaPolicy.upsert({
      where: { projectId: project.id },
      create: { projectId: project.id, ...parsed.data },
      update: parsed.data,
    })

    return ok(policy)
  } catch (e) {
    return serverError(e)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { projectKey: string } }) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const project = await prisma.project.findUnique({
      where: { key: params.projectKey },
      include: { members: { where: { userId: session.user.id } } },
    })
    if (!project) return notFound('Project')

    const isGlobalAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(session.user.role)
    const projectRole = project.members[0]?.role
    if (!isGlobalAdmin && !['OWNER', 'ADMIN'].includes(projectRole ?? '')) return forbidden()

    await prisma.slaPolicy.deleteMany({ where: { projectId: project.id } })
    return ok({ deleted: true })
  } catch (e) {
    return serverError(e)
  }
}
