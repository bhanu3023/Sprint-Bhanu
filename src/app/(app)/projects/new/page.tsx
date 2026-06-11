'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FolderKanban, ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import toast from 'react-hot-toast'

const AVATAR_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316']

export default function NewProjectPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState('SCRUM')
  const [avatarColor, setAvatarColor] = useState(AVATAR_COLORS[0])
  const [keyManual, setKeyManual] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const derivedKey = name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase()

  const handleNameChange = (v: string) => {
    setName(v)
    if (!keyManual) setKey(v.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase())
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !key.trim()) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), key: key.trim(), description: description.trim(), type, avatarColor }),
      })
      if (!res.ok) {
        const err = await res.json()
        toast.error(err.error ?? 'Failed to create project')
        return
      }
      const { data } = await res.json()
      toast.success('Project created!')
      router.push(`/projects/${data.key}/board`)
    } catch {
      toast.error('Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <Link href="/projects" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Projects
      </Link>

      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-lg"
            style={{ backgroundColor: avatarColor }}>
            {key.slice(0, 2) || <FolderKanban className="w-5 h-5" />}
          </div>
          <div>
            <h1 className="text-xl font-bold">Create New Project</h1>
            <p className="text-sm text-muted-foreground">Set up your sprint board</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium mb-1.5">Project Name <span className="text-red-500">*</span></label>
            <input value={name} onChange={(e) => handleNameChange(e.target.value)} required
              placeholder="e.g. My Product Team"
              className="w-full px-3 py-2 border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-ring" />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">Project Key <span className="text-red-500">*</span></label>
            <input value={key} onChange={(e) => { setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')); setKeyManual(true) }}
              required maxLength={6} placeholder="e.g. DEV"
              className="w-full px-3 py-2 border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-ring font-mono" />
            <p className="text-xs text-muted-foreground mt-1">2-6 uppercase letters/numbers. Used as issue key prefix (e.g. DEV-1)</p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
              placeholder="What is this project about?"
              className="w-full px-3 py-2 border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-ring resize-none" />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">Project Type</label>
            <select value={type} onChange={(e) => setType(e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-ring">
              <option value="SCRUM">Scrum</option>
              <option value="KANBAN">Kanban</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Project Color</label>
            <div className="flex gap-2 flex-wrap">
              {AVATAR_COLORS.map((color) => (
                <button key={color} type="button" onClick={() => setAvatarColor(color)}
                  className={`w-8 h-8 rounded-full transition-all ${avatarColor === color ? 'ring-2 ring-offset-2 ring-ring scale-110' : 'hover:scale-105'}`}
                  style={{ backgroundColor: color }} />
              ))}
            </div>
          </div>

          <button type="submit" disabled={submitting || !name.trim() || !key.trim()}
            className="w-full py-2.5 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
            {submitting ? 'Creating...' : 'Create Project'}
          </button>
        </form>
      </div>
    </div>
  )
}
