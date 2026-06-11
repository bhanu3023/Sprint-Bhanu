import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthSession, ok, notFound, unauthorized, forbidden, serverError, badRequest } from '@/lib/api-helpers'
import { z } from 'zod'
import { GlobalRole, ProjectRole } from '@prisma/client'

const updateUserSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  role: z.nativeEnum(GlobalRole).optional(),
  isActive: z.boolean().optional(),
  jobTitle: z.string().max(100).optional().nullable(),
  department: z.string().max(100).optional().nullable(),
})

const updateMembershipsSchema = z.object({
  memberships: z.array(z.object({
    projectId: z.string(),
    role: z.nativeEnum(ProjectRole),
    action: z.enum(['add', 'update', 'remove']),
  })),
})

export async function PATCH(req: NextRequest, { params }: { params: { userId: string } }) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()
    if (!['SUPER_ADMIN', 'ADMIN'].includes(session.user.role)) return forbidden()

    const body = await req.json()

    // Handle membership updates
    if ('memberships' in body) {
      const parsed = updateMembershipsSchema.safeParse(body)
      if (!parsed.success) return badRequest('Validation failed', parsed.error.flatten().fieldErrors)

      for (const m of parsed.data.memberships) {
        if (m.action === 'remove') {
          await prisma.projectMember.deleteMany({
            where: { projectId: m.projectId, userId: params.userId },
          })
        } else if (m.action === 'add') {
          await prisma.projectMember.upsert({
            where: { projectId_userId: { projectId: m.projectId, userId: params.userId } },
            create: { projectId: m.projectId, userId: params.userId, role: m.role },
            update: { role: m.role },
          })
        } else {
          await prisma.projectMember.updateMany({
            where: { projectId: m.projectId, userId: params.userId },
            data: { role: m.role },
          })
        }
      }

      const user = await prisma.user.findUnique({
        where: { id: params.userId },
        include: {
          projectMembers: {
            include: { project: { select: { id: true, key: true, name: true, avatarColor: true } } },
          },
        },
      })
      return ok(user)
    }

    // Handle user field updates
    const parsed = updateUserSchema.safeParse(body)
    if (!parsed.success) return badRequest('Validation failed', parsed.error.flatten().fieldErrors)

    const user = await prisma.user.update({
      where: { id: params.userId },
      data: parsed.data,
      select: {
        id: true, name: true, email: true, role: true, isActive: true,
        avatarColor: true, jobTitle: true, department: true, createdAt: true,
      },
    })

    return ok(user)
  } catch (e) {
    return serverError(e)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { userId: string } }) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()
    if (!['SUPER_ADMIN'].includes(session.user.role)) return forbidden()

    const target = await prisma.user.findUnique({ where: { id: params.userId } })
    if (!target) return notFound('User')

    // Soft delete
    await prisma.user.update({
      where: { id: params.userId },
      data: { isActive: false },
    })

    return ok({ deactivated: true })
  } catch (e) {
    return serverError(e)
  }
}
