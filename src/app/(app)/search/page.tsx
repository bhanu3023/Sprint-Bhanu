'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Search, FolderKanban, User, Loader2 } from 'lucide-react'
import { ISSUE_TYPE_COLORS } from '@/lib/utils'
import { cn } from '@/lib/utils'

export default function SearchPage() {
  const searchParams = useSearchParams()
  const query = searchParams.get('q') ?? ''
  const [results, setResults] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [activeType, setActiveType] = useState('all')

  useEffect(() => {
    if (query.length < 2) { setResults(null); return }
    setLoading(true)
    fetch(`/api/search?q=${encodeURIComponent(query)}&type=${activeType}`)
      .then((r) => r.json())
      .then((json) => setResults(json.data))
      .finally(() => setLoading(false))
  }, [query, activeType])

  const totalResults = results
    ? (results.issues?.length ?? 0) + (results.projects?.length ?? 0) + (results.users?.length ?? 0)
    : 0

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Search Results</h1>
      {query && <p className="text-muted-foreground mb-6">Showing results for &quot;<strong>{query}</strong>&quot;</p>}

      {/* Type filters */}
      <div className="flex gap-2 mb-6">
        {['all', 'issue', 'project', 'user'].map((type) => (
          <button
            key={type}
            onClick={() => setActiveType(type)}
            className={cn(
              'px-3 py-1.5 rounded-full text-sm font-medium transition-colors capitalize',
              activeType === type ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-accent',
            )}
          >
            {type}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : !query ? (
        <div className="text-center py-20 text-muted-foreground">
          <Search className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>Enter a search term to get started</p>
        </div>
      ) : results && totalResults === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <Search className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No results found</p>
          <p className="text-sm">Try a different search term</p>
        </div>
      ) : results ? (
        <div className="space-y-6">
          {/* Issues */}
          {results.issues?.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Issues ({results.issues.length})
              </h2>
              <div className="space-y-2">
                {results.issues.map((issue: any) => {
                  const typeColor = ISSUE_TYPE_COLORS[issue.type as keyof typeof ISSUE_TYPE_COLORS] ?? ISSUE_TYPE_COLORS.TASK
                  return (
                    <Link
                      key={issue.id}
                      href={`/projects/${issue.project.key}/issues/${issue.key}`}
                      className="flex items-center gap-3 p-3.5 bg-card border border-border rounded-xl hover:shadow-md transition-all"
                    >
                      <span className={cn('text-xs font-bold px-1.5 py-0.5 rounded shrink-0', typeColor.bg, typeColor.text)}>
                        {issue.type[0]}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground shrink-0">{issue.key}</span>
                      <span className="flex-1 font-medium">{issue.title}</span>
                      <span className="text-xs text-muted-foreground">{issue.project.name}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full text-white shrink-0" style={{ backgroundColor: issue.status.color }}>
                        {issue.status.name}
                      </span>
                    </Link>
                  )
                })}
              </div>
            </section>
          )}

          {/* Projects */}
          {results.projects?.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Projects ({results.projects.length})
              </h2>
              <div className="space-y-2">
                {results.projects.map((project: any) => (
                  <Link
                    key={project.id}
                    href={`/projects/${project.key}/board`}
                    className="flex items-center gap-3 p-3.5 bg-card border border-border rounded-xl hover:shadow-md transition-all"
                  >
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm" style={{ backgroundColor: project.avatarColor }}>
                      {project.key.slice(0, 2)}
                    </div>
                    <span className="font-medium">{project.name}</span>
                    <span className="text-xs font-mono text-muted-foreground">{project.key}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Users */}
          {results.users?.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                People ({results.users.length})
              </h2>
              <div className="space-y-2">
                {results.users.map((user: any) => (
                  <Link
                    key={user.id}
                    href={`/users/${user.id}`}
                    className="flex items-center gap-3 p-3.5 bg-card border border-border rounded-xl hover:shadow-md transition-all"
                  >
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-medium" style={{ backgroundColor: user.avatarColor }}>
                      {user.name[0].toUpperCase()}
                    </div>
                    <span className="font-medium">{user.name}</span>
                    <span className="text-sm text-muted-foreground">{user.email}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      ) : null}
    </div>
  )
}
