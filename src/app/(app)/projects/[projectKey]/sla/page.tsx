import type { Metadata } from 'next'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { notFound, redirect } from 'next/navigation'
import { SlaConfigView } from '@/components/sla/SlaConfigView'
import { SlaReportView } from '@/components/sla/SlaReportView'
import { ShieldAlert } from 'lucide-react'

export const metadata: Metadata = { title: 'SLA Management' }

export default async function SlaPage({ params }: { params: { projectKey: string } }) {
  const session = await getSession()
  if (!session) return null

  const project = await prisma.project.findUnique({
    where: { key: params.projectKey },
    include: {
      slaPolicy: true,
      members: { where: { userId: session.user.id } },
      issues: {
        include: { status: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      },
    },
  })

  if (!project) notFound()

  const isGlobalAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(session.user.role)
  const projectRole = project.members[0]?.role
  const canManage = isGlobalAdmin || ['OWNER', 'ADMIN', 'SCRUM_MASTER'].includes(projectRole ?? '')

  if (!canManage) redirect(`/projects/${params.projectKey}/board`)

  // Build SLA stats
  const issues = project.issues
  const withSla = issues.filter((i) => i.slaResponseDeadline || i.slaResolutionDeadline)
  const responseBreached = issues.filter((i) => i.slaResponseBreached).length
  const resolutionBreached = issues.filter((i) => i.slaResolutionBreached).length
  const total = withSla.length

  return (
    <div className="max-w-5xl space-y-8">
      <div className="flex items-center gap-3">
        <ShieldAlert className="w-5 h-5 text-amber-500" />
        <div>
          <h1 className="text-xl font-bold">SLA Management</h1>
          <p className="text-sm text-muted-foreground">Configure and monitor Service Level Agreements</p>
        </div>
      </div>

      {/* Stats overview */}
      {total > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total w/ SLA" value={total} />
          <StatCard label="Response Breached" value={responseBreached} danger={responseBreached > 0} />
          <StatCard label="Resolution Breached" value={resolutionBreached} danger={resolutionBreached > 0} />
          <StatCard
            label="Compliance Rate"
            value={`${total > 0 ? Math.round(((total - Math.max(responseBreached, resolutionBreached)) / total) * 100) : 100}%`}
            success
          />
        </div>
      )}

      <SlaConfigView projectKey={params.projectKey} initialPolicy={project.slaPolicy} />

      {withSla.length > 0 && (
        <SlaReportView issues={withSla.map((i) => ({
          id: i.id,
          key: i.key,
          title: i.title,
          priority: i.priority,
          statusName: i.status.name,
          statusCategory: i.status.category,
          slaResponseDeadline: i.slaResponseDeadline?.toISOString() ?? null,
          slaResolutionDeadline: i.slaResolutionDeadline?.toISOString() ?? null,
          slaResponseBreached: i.slaResponseBreached,
          slaResolutionBreached: i.slaResolutionBreached,
          slaResponseMet: i.slaResponseMet?.toISOString() ?? null,
          createdAt: i.createdAt.toISOString(),
        }))} projectKey={params.projectKey} />
      )}
    </div>
  )
}

function StatCard({ label, value, danger, success }: { label: string; value: string | number; danger?: boolean; success?: boolean }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <p className="text-xs text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${danger ? 'text-red-500' : success ? 'text-green-500' : 'text-foreground'}`}>
        {value}
      </p>
    </div>
  )
}
