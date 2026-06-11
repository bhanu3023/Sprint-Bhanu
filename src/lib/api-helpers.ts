import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ProjectRole } from '@prisma/client'

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ data }, { status })
}

export function created<T>(data: T) {
  return NextResponse.json({ data }, { status: 201 })
}

export function noContent() {
  return new NextResponse(null, { status: 204 })
}

export function badRequest(message: string, errors?: unknown) {
  return NextResponse.json({ error: message, errors }, { status: 400 })
}

export function unauthorized(message = 'Unauthorized') {
  return NextResponse.json({ error: message }, { status: 401 })
}

export function forbidden(message = 'Forbidden') {
  return NextResponse.json({ error: message }, { status: 403 })
}

export function notFound(resource = 'Resource') {
  return NextResponse.json({ error: `${resource} not found` }, { status: 404 })
}

export function conflict(message: string) {
  return NextResponse.json({ error: message }, { status: 409 })
}

export function serverError(error: unknown) {
  console.error('[API Error]', error)
  const message = error instanceof Error ? error.message : 'Internal server error'
  return NextResponse.json({ error: message }, { status: 500 })
}

export function handleError(error: unknown) {
  if (error instanceof ZodError) {
    return badRequest('Validation failed', error.errors)
  }
  if (error instanceof Error) {
    if (error.message === 'UNAUTHORIZED') return unauthorized()
    if (error.message === 'FORBIDDEN') return forbidden()
  }
  return serverError(error)
}

// Helper to get session and validate auth in API routes
export async function getAuthSession() {
  const session = await getSession()
  if (!session?.user) return null
  return session
}

// Get the project role of the current user for a given project
export async function getProjectRole(projectKey: string, userId: string): Promise<ProjectRole | null> {
  const project = await prisma.project.findUnique({
    where: { key: projectKey },
    select: { id: true },
  })
  if (!project) return null

  const member = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId: project.id, userId } },
    select: { role: true },
  })
  return member?.role ?? null
}

// Generate next issue key for a project
export async function generateIssueKey(projectId: string, projectKey: string): Promise<string> {
  const project = await prisma.$transaction(async (tx) => {
    const p = await tx.project.update({
      where: { id: projectId },
      data: { issueCounter: { increment: 1 } },
      select: { issueCounter: true },
    })
    return p
  })
  return `${projectKey}-${project.issueCounter}`
}
