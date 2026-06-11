import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthSession, ok, created, unauthorized, forbidden, serverError, badRequest, conflict } from '@/lib/api-helpers'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { GlobalRole } from '@prisma/client'

const createUserSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.nativeEnum(GlobalRole).optional().default('MEMBER'),
  jobTitle: z.string().max(100).optional(),
  department: z.string().max(100).optional(),
})

export async function GET(_req: NextRequest) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()
    if (!['SUPER_ADMIN', 'ADMIN'].includes(session.user.role)) return forbidden()

    const users = await prisma.user.findMany({
      include: {
        _count: { select: { assignedIssues: true } },
        projectMembers: {
          include: {
            project: { select: { id: true, key: true, name: true, avatarColor: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    return ok(users)
  } catch (e) {
    return serverError(e)
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()
    if (!['SUPER_ADMIN', 'ADMIN'].includes(session.user.role)) return forbidden()

    const body = await req.json()
    const parsed = createUserSchema.safeParse(body)
    if (!parsed.success) return badRequest('Validation failed', parsed.error.flatten().fieldErrors)

    const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } })
    if (existing) return conflict('Email already in use')

    const passwordHash = await bcrypt.hash(parsed.data.password, 12)
    const colors = ['#6366F1', '#8B5CF6', '#EC4899', '#EF4444', '#F97316', '#EAB308', '#22C55E', '#06B6D4', '#3B82F6']
    const avatarColor = colors[Math.floor(Math.random() * colors.length)]

    const user = await prisma.user.create({
      data: {
        name: parsed.data.name,
        email: parsed.data.email,
        passwordHash,
        role: parsed.data.role,
        jobTitle: parsed.data.jobTitle,
        department: parsed.data.department,
        avatarColor,
      },
      select: {
        id: true, name: true, email: true, role: true, isActive: true,
        avatarColor: true, jobTitle: true, department: true, createdAt: true,
      },
    })

    return created(user)
  } catch (e) {
    return serverError(e)
  }
}
