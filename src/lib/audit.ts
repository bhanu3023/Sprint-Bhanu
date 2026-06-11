import { prisma } from '@/lib/prisma'

interface AuditInput {
  actorId: string
  projectId?: string
  issueId?: string
  entityType: string
  entityId: string
  action: string
  changes?: Record<string, unknown>
}

export async function writeAuditLog(input: AuditInput) {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: input.actorId,
        projectId: input.projectId,
        issueId: input.issueId,
        entityType: input.entityType,
        entityId: input.entityId,
        action: input.action,
        changes: input.changes ? JSON.parse(JSON.stringify(input.changes)) : undefined,
      },
    })
  } catch (e) {
    // Audit log failures should not break the main operation
    console.error('Failed to write audit log:', e)
  }
}
