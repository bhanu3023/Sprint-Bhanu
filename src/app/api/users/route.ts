import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { getAuthSession } from '@/lib/api-helpers'
import { ok, created, badRequest, unauthorized, forbidden, serverError, conflict } from '@/lib/api-helpers'
import { registerSchema } from '@/lib/validations/auth.schema'
import { GlobalRole } from '@prisma/client'

export async function GET(req: NextRequest) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const { searchParams } = new URL(req.url)
    const search = searchParams.get('search') || ''
    const role = searchParams.get('role') as GlobalRole | null
    const isActive = searchParams.get('isActive')
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = parseInt(searchParams.get('pageSize') || '20')

    const where = {
      AND: [
        search ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            { email: { contains: search, mode: 'insensitive' as const } },
          ],
        } : {},
        role ? { role } : {},
        isActive !== null ? { isActive: isActive === 'true' } : {},
      ],
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true, name: true, email: true, avatarUrl: true, avatarColor: true,
          role: true, isActive: true, jobTitle: true, department: true, createdAt: true,
          _count: { select: { assignedIssues: true, projectMembers: true } },
        },
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.user.count({ where }),
    ])

    return ok({ users, total, page, pageSize, totalPages: Math.ceil(total / pageSize) })
  } catch (e) {
    return serverError(e)
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(session.user.role)
    if (!isAdmin) return forbidden()

    const body = await req.json()
    const parsed = registerSchema.safeParse(body)
    if (!parsed.success) return badRequest('Validation failed', parsed.error.errors)

    const { name, email, password } = parsed.data

    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } })
    if (existing) return conflict('A user with this email already exists')

    const passwordHash = await bcrypt.hash(password, 12)
    const user = await prisma.user.create({
      data: {
        name,
        email: email.toLowerCase(),
        passwordHash,
        role: GlobalRole.MEMBER,
      },
      select: {
        id: true, name: true, email: true, avatarUrl: true,
        avatarColor: true, role: true, isActive: true, createdAt: true,
      },
    })

    return created(user)
  } catch (e) {
    return serverError(e)
  }
}
