import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { getAuthSession, ok, badRequest, unauthorized, serverError } from '@/lib/api-helpers'
import { z } from 'zod'

const updateProfileSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  avatarColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  jobTitle: z.string().max(100).optional().nullable(),
  department: z.string().max(100).optional().nullable(),
  bio: z.string().max(500).optional().nullable(),
  timezone: z.string().optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8).optional(),
})

export async function GET() {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true, name: true, email: true, avatarUrl: true, avatarColor: true,
        role: true, isActive: true, jobTitle: true, department: true,
        bio: true, timezone: true, createdAt: true,
        _count: {
          select: { assignedIssues: true, reportedIssues: true, projectMembers: true },
        },
      },
    })

    return ok(user)
  } catch (e) {
    return serverError(e)
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const body = await req.json()
    const parsed = updateProfileSchema.safeParse(body)
    if (!parsed.success) return badRequest('Validation failed', parsed.error.errors)

    const { currentPassword, newPassword, ...updateData } = parsed.data

    // Handle password change
    if (newPassword) {
      if (!currentPassword) return badRequest('Current password is required to set a new password')
      const user = await prisma.user.findUnique({ where: { id: session.user.id } })
      if (!user) return unauthorized()
      const valid = await bcrypt.compare(currentPassword, user.passwordHash)
      if (!valid) return badRequest('Current password is incorrect')
      const passwordHash = await bcrypt.hash(newPassword, 12)
      await prisma.user.update({
        where: { id: session.user.id },
        data: { ...updateData, passwordHash },
      })
    } else {
      await prisma.user.update({ where: { id: session.user.id }, data: updateData })
    }

    const updated = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true, name: true, email: true, avatarUrl: true,
        avatarColor: true, role: true, jobTitle: true, department: true, bio: true,
      },
    })

    return ok(updated)
  } catch (e) {
    return serverError(e)
  }
}
