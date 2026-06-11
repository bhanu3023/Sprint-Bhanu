import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthSession, getProjectRole, ok, created, badRequest, unauthorized, forbidden, notFound, serverError, noContent, conflict } from '@/lib/api-helpers'
import { addMemberSchema, updateMemberSchema } from '@/lib/validations/project.schema'

type Params = { params: { projectKey: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const project = await prisma.project.findUnique({ where: { key: params.projectKey } })
    if (!project) return notFound('Project')

    const members = await prisma.projectMember.findMany({
      where: { projectId: project.id },
      include: {
        user: { select: { id: true, name: true, email: true, avatarUrl: true, avatarColor: true, isActive: true, jobTitle: true } },
      },
      orderBy: { joinedAt: 'asc' },
    })

    return ok(members)
  } catch (e) {
    return serverError(e)
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const projectRole = await getProjectRole(params.projectKey, session.user.id)
    const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(session.user.role)
    const canManage = isAdmin || ['OWNER', 'ADMIN'].includes(projectRole ?? '')
    if (!canManage) return forbidden()

    const project = await prisma.project.findUnique({ where: { key: params.projectKey } })
    if (!project) return notFound('Project')

    const body = await req.json()
    const parsed = addMemberSchema.safeParse(body)
    if (!parsed.success) return badRequest('Validation failed', parsed.error.errors)

    const existing = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: project.id, userId: parsed.data.userId } },
    })
    if (existing) return conflict('User is already a member of this project')

    const member = await prisma.projectMember.create({
      data: { projectId: project.id, userId: parsed.data.userId, role: parsed.data.role },
      include: {
        user: { select: { id: true, name: true, email: true, avatarUrl: true, avatarColor: true } },
      },
    })

    return created(member)
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
    if (!isAdmin && !['OWNER', 'ADMIN'].includes(projectRole ?? '')) return forbidden()

    const project = await prisma.project.findUnique({ where: { key: params.projectKey } })
    if (!project) return notFound('Project')

    const body = await req.json()
    const { userId, ...rest } = body
    const parsed = updateMemberSchema.safeParse(rest)
    if (!parsed.success) return badRequest('Validation failed', parsed.error.errors)

    const member = await prisma.projectMember.update({
      where: { projectId_userId: { projectId: project.id, userId } },
      data: { role: parsed.data.role },
      include: {
        user: { select: { id: true, name: true, email: true, avatarUrl: true, avatarColor: true } },
      },
    })

    return ok(member)
  } catch (e) {
    return serverError(e)
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const projectRole = await getProjectRole(params.projectKey, session.user.id)
    const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(session.user.role)
    if (!isAdmin && !['OWNER', 'ADMIN'].includes(projectRole ?? '')) return forbidden()

    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('userId')
    if (!userId) return badRequest('userId is required')

    const project = await prisma.project.findUnique({ where: { key: params.projectKey } })
    if (!project) return notFound('Project')

    await prisma.projectMember.delete({
      where: { projectId_userId: { projectId: project.id, userId } },
    })

    return noContent()
  } catch (e) {
    return serverError(e)
  }
}
