import type { Metadata } from 'next'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Activity } from 'lucide-react'

export const metadata: Metadata = { title: 'Project Activity' }

export default async function ProjectActivityPage({ params }: { params: { projectKey: string } }) {
  const session = await getSession()
  if (!session) return null

  const project = await prisma.project.findUnique({ where: { key: params.projectKey } })
  if (!project) notFound()

  const logs = await prisma.auditLog.findMany({
    where: { projectId: project.id },
    include: {
      actor: { select: { id: true, name: true, avatarColor: true } },
      issue: { select: { key: true, title: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  const grouped: Record<string, typeof logs> = {}
  for (const log of logs) {
    const date = new Date(log.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    if (!grouped[date]) grouped[date] = []
    grouped[date].push(log)
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Activity className="w-5 h-5 text-muted-foreground" />
        <h1 className="text-xl font-bold">{project.name} · Activity</h1>
      </div>

      {Object.keys(grouped).length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Activity className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No activity yet</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([date, entries]) => (
            <div key={date}>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">{date}</h2>
              <div className="bg-card border border-border rounded-xl divide-y divide-border">
                {entries.map((log) => (
                  <div key={log.id} className="flex items-start gap-3 px-5 py-3">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs shrink-0 mt-0.5"
                      style={{ backgroundColor: log.actor.avatarColor }}>
                      {log.actor.name[0].toUpperCase()}
                    </div>
                    <div className="flex-1 text-sm">
                      <Link href={`/users/${log.actor.id}`} className="font-medium hover:text-primary transition-colors">{log.actor.name}</Link>{' '}
                      <span className="text-muted-foreground">{log.action.toLowerCase().replace(/_/g, ' ')}</span>{' '}
                      <span className="text-muted-foreground font-medium">{log.entityType.toLowerCase()}</span>
                      {log.issue && (
                        <Link href={`/projects/${params.projectKey}/issues/${log.issue.key}`}
                          className="text-primary hover:underline ml-1">
                          {log.issue.key}: {log.issue.title}
                        </Link>
                      )}
                      {log.changes && (
                        <div className="mt-1 text-xs text-muted-foreground bg-muted rounded px-2 py-1 font-mono">
                          {Object.entries(log.changes as Record<string, unknown>).map(([k, v]) => (
                            <span key={k}>{k}: {String(v)} </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {new Date(log.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
