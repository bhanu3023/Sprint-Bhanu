import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthSession, ok, created, badRequest, unauthorized, serverError, conflict } from '@/lib/api-helpers'
import { createProjectSchema } from '@/lib/validations/project.schema'
import { ProjectRole, StatusCategory } from '@prisma/client'
import { writeAuditLog } from '@/lib/audit'

export async function GET(req: NextRequest) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const { searchParams } = new URL(req.url)
    const search = searchParams.get('search') || ''
    const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(session.user.role)

    const projects = await prisma.project.findMany({
      where: {
        isArchived: false,
        ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}),
        // Non-admins can only see projects they're members of
        ...(!isAdmin ? {
          OR: [
            { ownerId: session.user.id },
            { members: { some: { userId: session.user.id } } },
          ],
        } : {}),
      },
      include: {
        owner: { select: { id: true, name: true, email: true, avatarUrl: true, avatarColor: true } },
        _count: { select: { issues: true, members: true, sprints: true } },
        members: {
          take: 5,
          include: { user: { select: { id: true, name: true, avatarUrl: true, avatarColor: true } } },
        },
        sprints: {
          where: { status: 'ACTIVE' },
          take: 1,
          select: { id: true, name: true, status: true, endDate: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    return ok(projects)
  } catch (e) {
    return serverError(e)
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession()
    if (!session) return unauthorized()

    const body = await req.json()
    const parsed = createProjectSchema.safeParse(body)
    if (!parsed.success) return badRequest('Validation failed', parsed.error.errors)

    const { key, name, description, avatarColor } = parsed.data

    const existing = await prisma.project.findUnique({ where: { key } })
    if (existing) return conflict(`Project key "${key}" is already taken`)

    // Create project with default workflow and columns in a transaction
    const project = await prisma.$transaction(async (tx) => {
      const p = await tx.project.create({
        data: {
          key,
          name,
          description,
          avatarColor: avatarColor ?? '#6366F1',
          ownerId: session.user.id,
        },
      })

      // Add owner as project member
      await tx.projectMember.create({
        data: { projectId: p.id, userId: session.user.id, role: ProjectRole.OWNER },
      })

      // Create default workflow statuses
      const todo = await tx.workflowStatus.create({
        data: { projectId: p.id, name: 'To Do', category: StatusCategory.TODO, color: '#64748B', order: 0, isDefault: true },
      })
      const inProgress = await tx.workflowStatus.create({
        data: { projectId: p.id, name: 'In Progress', category: StatusCategory.IN_PROGRESS, color: '#3B82F6', order: 1 },
      })
      const inReview = await tx.workflowStatus.create({
        data: { projectId: p.id, name: 'In Review', category: StatusCategory.IN_PROGRESS, color: '#F59E0B', order: 2 },
      })
      const done = await tx.workflowStatus.create({
        data: { projectId: p.id, name: 'Done', category: StatusCategory.DONE, color: '#10B981', order: 3 },
      })

      // Create default transitions
      const transitions = [
        { from: todo.id, to: inProgress.id, name: 'Start Progress' },
        { from: inProgress.id, to: inReview.id, name: 'Send for Review' },
        { from: inProgress.id, to: todo.id, name: 'Reopen' },
        { from: inReview.id, to: done.id, name: 'Approve' },
        { from: inReview.id, to: inProgress.id, name: 'Return to Dev' },
        { from: done.id, to: todo.id, name: 'Reopen' },
      ]
      for (const t of transitions) {
        await tx.workflowTransition.create({
          data: { projectId: p.id, fromStatusId: t.from, toStatusId: t.to, name: t.name },
        })
      }

      // Create default board columns
      await tx.boardColumn.createMany({
        data: [
          { projectId: p.id, name: 'To Do', order: 0, color: '#F1F5F9', statusId: todo.id },
          { projectId: p.id, name: 'In Progress', order: 1, color: '#DBEAFE', statusId: inProgress.id, wipLimit: 5 },
          { projectId: p.id, name: 'In Review', order: 2, color: '#FEF9C3', statusId: inReview.id },
          { projectId: p.id, name: 'Done', order: 3, color: '#DCFCE7', statusId: done.id },
        ],
      })

      return p
    })

    await writeAuditLog({
      actorId: session.user.id,
      projectId: project.id,
      entityType: 'Project',
      entityId: project.id,
      action: 'created',
      changes: { name, key },
    })

    const full = await prisma.project.findUnique({
      where: { id: project.id },
      include: {
        owner: { select: { id: true, name: true, email: true, avatarUrl: true, avatarColor: true } },
        _count: { select: { issues: true, members: true, sprints: true } },
      },
    })

    return created(full)
  } catch (e) {
    return serverError(e)
  }
}
