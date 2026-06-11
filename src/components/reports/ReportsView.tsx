'use client'

import { useState, useEffect } from 'react'
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { BarChart3, TrendingDown, Activity, Target, Loader2 } from 'lucide-react'

interface ReportsViewProps {
  project: { id: string; key: string; name: string }
  sprints: Array<{ id: string; name: string; status: string; startDate?: Date | null; endDate?: Date | null }>
  issuesByStatus: Array<{ id: string; name: string; color: string; category: string; _count: { issues: number } }>
  issuesByType: Array<{ type: string; _count: { _all: number } }>
  issuesByPriority: Array<{ priority: string; _count: { _all: number } }>
  assigneeStats: Array<{ id: string; name: string; avatarColor: string; _count: { assignedIssues: number } }>
}

const COLORS = ['#6366F1', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4', '#EC4899']

export function ReportsView({ project, sprints, issuesByStatus, issuesByType, issuesByPriority, assigneeStats }: ReportsViewProps) {
  const [selectedSprint, setSelectedSprint] = useState(sprints.find((s) => s.status === 'ACTIVE')?.id ?? sprints[0]?.id ?? '')
  const [burndownData, setBurndownData] = useState<any>(null)
  const [loadingBurndown, setLoadingBurndown] = useState(false)

  useEffect(() => {
    if (!selectedSprint) return
    setLoadingBurndown(true)
    fetch(`/api/reports/${project.key}/burndown?sprintId=${selectedSprint}`)
      .then((r) => r.json())
      .then((json) => { if (json.data) setBurndownData(json.data) })
      .finally(() => setLoadingBurndown(false))
  }, [selectedSprint, project.key])

  const statusData = issuesByStatus.map((s) => ({ name: s.name, count: s._count.issues, color: s.color }))
  const typeData = issuesByType.map((t) => ({ name: t.type, value: t._count._all }))
  const priorityData = issuesByPriority.map((p) => ({ name: p.priority, count: p._count._all }))

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold">{project.name} · Reports</h1>
        <p className="text-muted-foreground text-sm">Insights and progress tracking for your project</p>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {/* Burndown Chart */}
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-blue-500" /> Burndown Chart
            </h2>
            <select
              value={selectedSprint}
              onChange={(e) => setSelectedSprint(e.target.value)}
              className="text-sm border border-border rounded-lg px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {sprints.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          {loadingBurndown ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : burndownData ? (
            <>
              {/* Summary */}
              <div className="grid grid-cols-3 gap-4 mb-5">
                {[
                  { label: 'Total Points', value: burndownData.summary.totalPoints },
                  { label: 'Completed', value: burndownData.summary.completedPoints },
                  { label: 'Progress', value: `${burndownData.summary.completionPercent}%` },
                ].map(({ label, value }) => (
                  <div key={label} className="text-center p-3 bg-muted/40 rounded-lg">
                    <p className="text-lg font-bold">{value}</p>
                    <p className="text-xs text-muted-foreground">{label}</p>
                  </div>
                ))}
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={burndownData.data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="ideal" stroke="#94A3B8" strokeDasharray="5 5" dot={false} name="Ideal" strokeWidth={2} />
                  <Line type="monotone" dataKey="actual" stroke="#6366F1" dot={{ fill: '#6366F1', r: 3 }} name="Actual" strokeWidth={2} connectNulls={false} />
                </LineChart>
              </ResponsiveContainer>
            </>
          ) : (
            <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
              {sprints.length === 0 ? 'No sprints found' : 'Select a sprint to view burndown'}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Issues by Status */}
          <div className="bg-card border border-border rounded-xl p-5">
            <h2 className="text-base font-semibold mb-4 flex items-center gap-2">
              <Activity className="w-4 h-4 text-green-500" /> Issues by Status
            </h2>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={statusData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={80} />
                <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="count" radius={4}>
                  {statusData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Issues by Type */}
          <div className="bg-card border border-border rounded-xl p-5">
            <h2 className="text-base font-semibold mb-4 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-purple-500" /> Issues by Type
            </h2>
            {typeData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={typeData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={3}
                    dataKey="value"
                    label={({ name, value }) => `${name}: ${value}`}
                    labelLine={false}
                  >
                    {typeData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">No issue data</div>
            )}
          </div>

          {/* Issues by Priority */}
          <div className="bg-card border border-border rounded-xl p-5">
            <h2 className="text-base font-semibold mb-4 flex items-center gap-2">
              <Target className="w-4 h-4 text-orange-500" /> Issues by Priority
            </h2>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={priorityData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="count" radius={4}>
                  {priorityData.map((entry, i) => {
                    const colors: Record<string, string> = { HIGHEST: '#EF4444', HIGH: '#F97316', MEDIUM: '#F59E0B', LOW: '#3B82F6', LOWEST: '#94A3B8' }
                    return <Cell key={i} fill={colors[entry.name] ?? COLORS[i % COLORS.length]} />
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Issues by Assignee */}
          <div className="bg-card border border-border rounded-xl p-5">
            <h2 className="text-base font-semibold mb-4">Issues by Assignee</h2>
            {assigneeStats.length > 0 ? (
              <div className="space-y-3">
                {assigneeStats.map((person) => {
                  const max = Math.max(...assigneeStats.map((p) => p._count.assignedIssues))
                  const pct = max > 0 ? (person._count.assignedIssues / max) * 100 : 0
                  return (
                    <div key={person.id} className="flex items-center gap-3">
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-medium shrink-0"
                        style={{ backgroundColor: person.avatarColor }}
                      >
                        {person.name[0].toUpperCase()}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm">{person.name}</span>
                          <span className="text-xs font-medium text-muted-foreground">{person._count.assignedIssues}</span>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{ width: `${pct}%`, backgroundColor: person.avatarColor }}
                          />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">No assignments yet</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
