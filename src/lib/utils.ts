import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { formatDistanceToNow, format, isToday, isYesterday } from 'date-fns'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? new Date(date) : date
  if (isToday(d)) return `Today at ${format(d, 'h:mm a')}`
  if (isYesterday(d)) return `Yesterday at ${format(d, 'h:mm a')}`
  return format(d, 'MMM d, yyyy')
}

export function formatRelative(date: Date | string | null | undefined): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? new Date(date) : date
  return formatDistanceToNow(d, { addSuffix: true })
}

export function formatDateShort(date: Date | string | null | undefined): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? new Date(date) : date
  return format(d, 'MMM d')
}

export function formatDateRange(start?: Date | string | null, end?: Date | string | null): string {
  if (!start && !end) return 'No dates set'
  if (!start) return `Ends ${formatDate(end)}`
  if (!end) return `Starts ${formatDate(start)}`
  return `${formatDateShort(start)} – ${formatDateShort(end)}`
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function generateProjectKey(name: string): string {
  const words = name.trim().split(/\s+/)
  if (words.length === 1) {
    return words[0].slice(0, 3).toUpperCase()
  }
  return words
    .slice(0, 3)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export const PRIORITY_COLORS = {
  HIGHEST: { text: 'text-red-600', bg: 'bg-red-50 dark:bg-red-950', border: 'border-red-200' },
  HIGH: { text: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-950', border: 'border-orange-200' },
  MEDIUM: { text: 'text-yellow-600', bg: 'bg-yellow-50 dark:bg-yellow-950', border: 'border-yellow-200' },
  LOW: { text: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-950', border: 'border-blue-200' },
  LOWEST: { text: 'text-slate-500', bg: 'bg-slate-50 dark:bg-slate-950', border: 'border-slate-200' },
} as const

export const ISSUE_TYPE_COLORS = {
  EPIC: { text: 'text-purple-600', bg: 'bg-purple-100 dark:bg-purple-900' },
  STORY: { text: 'text-green-600', bg: 'bg-green-100 dark:bg-green-900' },
  TASK: { text: 'text-blue-600', bg: 'bg-blue-100 dark:bg-blue-900' },
  BUG: { text: 'text-red-600', bg: 'bg-red-100 dark:bg-red-900' },
  SUBTASK: { text: 'text-slate-600', bg: 'bg-slate-100 dark:bg-slate-800' },
} as const

export const STATUS_CATEGORY_COLORS = {
  TODO: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
  IN_PROGRESS: 'bg-blue-200 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  DONE: 'bg-green-200 text-green-800 dark:bg-green-900 dark:text-green-200',
} as const

export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  MEMBER: 'Member',
  OWNER: 'Owner',
  SCRUM_MASTER: 'Scrum Master',
  VIEWER: 'Viewer',
}

export const SPRINT_STATUS_COLORS = {
  PLANNED: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  ACTIVE: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  COMPLETED: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300',
} as const

export function truncate(str: string, length: number): string {
  if (str.length <= length) return str
  return str.slice(0, length) + '...'
}

export function pluralize(count: number, word: string, plural?: string): string {
  if (count === 1) return `${count} ${word}`
  return `${count} ${plural ?? word + 's'}`
}

export function buildApiUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
  const url = new URL(path, 'http://localhost')
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.set(key, String(value))
      }
    })
  }
  return url.pathname + url.search
}
