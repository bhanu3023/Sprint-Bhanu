'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { createProjectSchema, type CreateProjectInput } from '@/lib/validations/project.schema'
import { generateProjectKey } from '@/lib/utils'
import { Plus, FolderKanban, Search, MoreHorizontal, Archive, ExternalLink, Loader2, X, Users } from 'lucide-react'
import toast from 'react-hot-toast'
import { formatRelative } from '@/lib/utils'

interface Project {
  id: string
  key: string
  name: string
  description?: string | null
  avatarColor: string
  isArchived: boolean
  createdAt: Date
  updatedAt: Date
  owner: { id: string; name: string; avatarUrl?: string | null; avatarColor: string }
  _count: { issues: number; members: number; sprints: number }
  members: Array<{ userId: string; user: { id: string; name: string; avatarUrl?: string | null; avatarColor: string } }>
  sprints: Array<{ id: string; name: string; status: string }>
}

interface ProjectsViewProps {
  projects: Project[]
  users: Array<{ id: string; name: string; email: string; avatarUrl?: string | null; avatarColor: string }>
  session: { user: { id: string; role: string } }
}

const AVATAR_COLORS = [
  '#6366F1', '#8B5CF6', '#EC4899', '#EF4444', '#F59E0B',
  '#10B981', '#06B6D4', '#3B82F6', '#F97316', '#84CC16',
]

export function ProjectsView({ projects: initialProjects, users, session }: ProjectsViewProps) {
  const router = useRouter()
  const [projects, setProjects] = useState(initialProjects)
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [selectedColor, setSelectedColor] = useState(AVATAR_COLORS[0])

  const { register, handleSubmit, watch, setValue, reset, formState: { errors } } = useForm<CreateProjectInput>({
    resolver: zodResolver(createProjectSchema),
    defaultValues: { avatarColor: AVATAR_COLORS[0] },
  })

  const watchedName = watch('name')

  const onNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const key = generateProjectKey(e.target.value)
    setValue('key', key, { shouldValidate: false })
  }

  const onSubmit = async (data: CreateProjectInput) => {
    setIsCreating(true)
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, avatarColor: selectedColor }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error || 'Failed to create project')
        return
      }
      toast.success('Project created!')
      setShowCreate(false)
      reset()
      router.push(`/projects/${json.data.key}/board`)
    } finally {
      setIsCreating(false)
    }
  }

  const filtered = projects.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.key.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Projects</h1>
          <p className="text-muted-foreground text-sm mt-0.5">{projects.length} project{projects.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" /> Create Project
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search projects..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-sm pl-9 pr-4 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* Projects Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-20">
          <FolderKanban className="w-16 h-16 mx-auto mb-4 text-muted-foreground/30" />
          <h2 className="text-lg font-semibold mb-2">
            {search ? 'No projects match your search' : 'No projects yet'}
          </h2>
          <p className="text-muted-foreground text-sm mb-4">
            {search ? 'Try a different search term' : 'Create your first project to get started'}
          </p>
          {!search && (
            <button
              onClick={() => setShowCreate(true)}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Create Project
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((project) => (
            <div key={project.id} className="bg-card border border-border rounded-xl p-5 hover:shadow-lg transition-all group">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-sm shrink-0"
                    style={{ backgroundColor: project.avatarColor }}
                  >
                    {project.key.slice(0, 2)}
                  </div>
                  <div>
                    <Link
                      href={`/projects/${project.key}/board`}
                      className="font-semibold hover:text-primary transition-colors group-hover:text-primary"
                    >
                      {project.name}
                    </Link>
                    <p className="text-xs font-mono text-muted-foreground">{project.key}</p>
                  </div>
                </div>
                <Link
                  href={`/projects/${project.key}/board`}
                  className="p-1.5 rounded-md hover:bg-accent transition-colors opacity-0 group-hover:opacity-100"
                >
                  <ExternalLink className="w-4 h-4 text-muted-foreground" />
                </Link>
              </div>

              {project.description && (
                <p className="text-sm text-muted-foreground mb-4 line-clamp-2">{project.description}</p>
              )}

              {project.sprints[0] && (
                <div className="mb-3">
                  <span className="text-xs font-medium px-2 py-1 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 rounded-full">
                    ⚡ Active sprint
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between">
                <div className="flex -space-x-1.5">
                  {project.members.slice(0, 4).map((m) => (
                    <div
                      key={m.userId}
                      className="w-7 h-7 rounded-full border-2 border-card flex items-center justify-center text-white text-xs font-medium"
                      style={{ backgroundColor: m.user.avatarColor }}
                      title={m.user.name}
                    >
                      {m.user.avatarUrl ? (
                        <img src={m.user.avatarUrl} className="w-full h-full rounded-full object-cover" alt={m.user.name} />
                      ) : (
                        m.user.name[0].toUpperCase()
                      )}
                    </div>
                  ))}
                  {project._count.members > 4 && (
                    <div className="w-7 h-7 rounded-full border-2 border-card bg-muted flex items-center justify-center text-xs text-muted-foreground font-medium">
                      +{project._count.members - 4}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{project._count.issues} issues</span>
                  <span>·</span>
                  <span>{project._count.members} members</span>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-border grid grid-cols-3 gap-1">
                <Link
                  href={`/projects/${project.key}/board`}
                  className="text-xs text-center py-1.5 rounded-md hover:bg-accent transition-colors text-muted-foreground hover:text-foreground font-medium"
                >
                  Board
                </Link>
                <Link
                  href={`/projects/${project.key}/backlog`}
                  className="text-xs text-center py-1.5 rounded-md hover:bg-accent transition-colors text-muted-foreground hover:text-foreground font-medium"
                >
                  Backlog
                </Link>
                <Link
                  href={`/projects/${project.key}/settings`}
                  className="text-xs text-center py-1.5 rounded-md hover:bg-accent transition-colors text-muted-foreground hover:text-foreground font-medium"
                >
                  Settings
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Project Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/50" onClick={() => setShowCreate(false)} />
          <div className="relative bg-card border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold">Create Project</h2>
              <button onClick={() => setShowCreate(false)} className="p-1 rounded-md hover:bg-accent">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              {/* Color picker */}
              <div>
                <label className="block text-sm font-medium mb-2">Project Color</label>
                <div className="flex gap-2 flex-wrap">
                  {AVATAR_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => { setSelectedColor(color); setValue('avatarColor', color) }}
                      className="w-8 h-8 rounded-lg transition-transform hover:scale-110 ring-offset-2 ring-offset-card"
                      style={{
                        backgroundColor: color,
                        ...(selectedColor === color ? { boxShadow: `0 0 0 2px ${color}`, outline: '2px solid white' } : {}),
                      }}
                    />
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5">Project Name *</label>
                <input
                  {...register('name')}
                  placeholder="My Awesome Project"
                  onChange={(e) => { register('name').onChange(e); onNameChange(e) }}
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background"
                />
                {errors.name && <p className="text-destructive text-xs mt-1">{errors.name.message}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5">Project Key *</label>
                <input
                  {...register('key')}
                  placeholder="PROJ"
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-ring bg-background"
                  onChange={(e) => setValue('key', e.target.value.toUpperCase())}
                />
                <p className="text-xs text-muted-foreground mt-1">Used as a prefix for issue keys (e.g., PROJ-1)</p>
                {errors.key && <p className="text-destructive text-xs mt-1">{errors.key.message}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5">Description</label>
                <textarea
                  {...register('description')}
                  placeholder="What is this project about?"
                  rows={3}
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background resize-none"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="flex-1 py-2 border border-border rounded-lg text-sm hover:bg-accent transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  className="flex-1 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
                >
                  {isCreating && <Loader2 className="w-4 h-4 animate-spin" />}
                  Create Project
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
