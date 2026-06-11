import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthSession, ok, notFound, unauthorized, forbidden, serverError, noContent } from '@/lib/api-helpers'
import { z } from 'zod'
import { GlobalRole } from '@prisma/client'

const updateUserSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  role: z.nativeEnum(GlobalRole).optional(),
  isActive: z.boolean().optional(),
  jobTitle: z.string().max(100).optional().nullable(),
  department: z.string().max(100).optional().nullable(),
  bio: z.string().max(500).optional().nullable(),
  timezone: z.string().max(100).optional().nullable(),
})

export async function GET(_req: NextRequest, { params }: { params: { userId: string } }) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const user = await prisma.user.findUnique({
      where: { id: params.userId },
      select: {
        id: true, name: true, email: true, avatarUrl: true, avatarColor: true,
        role: true, isActive: true, jobTitle: true, department: true, bio: true,
        timezone: true, createdAt: true,
        projectMembers: {
          include: { project: { select: { id: true, key: true, name: true, avatarColor: true } } },
        },
        _count: { select: { assignedIssues: true, reportedIssues: true } },
      },
    })

    if (!user) return notFound('User')
    return ok(user)
  } catch (e) {
    return serverError(e)
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { userId: string } }) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(session.user.role)
    const isSelf = session.user.id === params.userId
    if (!isAdmin && !isSelf) return forbidden()

    const body = await req.json()
    const parsed = updateUserSchema.safeParse(body)
    if (!parsed.success) return notFound('Validation failed')

    // Only admins can change role/active status
    const data: Record<string, unknown> = {}
    if (parsed.data.name) data.name = parsed.data.name
    if (parsed.data.jobTitle !== undefined) data.jobTitle = parsed.data.jobTitle
    if (parsed.data.department !== undefined) data.department = parsed.data.department
    if (parsed.data.bio !== undefined) data.bio = parsed.data.bio
    if (parsed.data.timezone !== undefined) data.timezone = parsed.data.timezone
    if (isAdmin) {
      if (parsed.data.role) data.role = parsed.data.role
      if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive
    }

    const user = await prisma.user.update({
      where: { id: params.userId },
      data,
      select: {
        id: true, name: true, email: true, role: true, isActive: true,
        avatarColor: true, jobTitle: true, department: true,
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

    const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(session.user.role)
    if (!isAdmin) return forbidden()

    // Soft delete - just deactivate
    await prisma.user.update({
      where: { id: params.userId },
      data: { isActive: false },
    })

    return noContent()
  } catch (e) {
    return serverError(e)
  }
}
