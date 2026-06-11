'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Bell, Check, CheckCheck, Trash2 } from 'lucide-react'
import { cn, formatRelative } from '@/lib/utils'
import toast from 'react-hot-toast'

interface Notification {
  id: string; type: string; title: string; body: string; link?: string | null
  isRead: boolean; createdAt: Date
}

const NOTIF_ICONS: Record<string, { emoji: string; color: string }> = {
  ISSUE_ASSIGNED: { emoji: '👤', color: 'bg-blue-100 dark:bg-blue-900/40' },
  COMMENT_ADDED: { emoji: '💬', color: 'bg-purple-100 dark:bg-purple-900/40' },
  SPRINT_STARTED: { emoji: '⚡', color: 'bg-green-100 dark:bg-green-900/40' },
  SPRINT_COMPLETED: { emoji: '✅', color: 'bg-teal-100 dark:bg-teal-900/40' },
  STATUS_CHANGED: { emoji: '🔄', color: 'bg-amber-100 dark:bg-amber-900/40' },
  MEMBER_ADDED: { emoji: '👋', color: 'bg-pink-100 dark:bg-pink-900/40' },
  MENTIONED: { emoji: '@', color: 'bg-indigo-100 dark:bg-indigo-900/40' },
}

export function NotificationsView({ initialNotifications }: { initialNotifications: Notification[] }) {
  const [notifications, setNotifications] = useState(initialNotifications)
  const [markingAll, setMarkingAll] = useState(false)

  const unreadCount = notifications.filter((n) => !n.isRead).length

  const markAsRead = async (id: string) => {
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, isRead: true } : n))
    await fetch(`/api/notifications`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } })
  }

  const markAllRead = async () => {
    setMarkingAll(true)
    try {
      await fetch('/api/notifications', { method: 'DELETE' })
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })))
      toast.success('All notifications marked as read')
    } finally {
      setMarkingAll(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bell className="w-6 h-6" /> Notifications
          </h1>
          {unreadCount > 0 && (
            <p className="text-muted-foreground text-sm mt-0.5">{unreadCount} unread</p>
          )}
        </div>
        {unreadCount > 0 && (
          <button
            onClick={markAllRead}
            disabled={markingAll}
            className="flex items-center gap-2 px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-accent transition-colors"
          >
            <CheckCheck className="w-4 h-4" /> Mark all read
          </button>
        )}
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Bell className="w-12 h-12 mb-3 opacity-30" />
            <p className="font-medium">No notifications</p>
            <p className="text-sm">You&apos;re all caught up!</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {notifications.map((n) => {
              const icon = NOTIF_ICONS[n.type] ?? { emoji: '📋', color: 'bg-muted' }
              const content = (
                <div className={cn('flex items-start gap-3 px-4 py-3.5 hover:bg-muted/30 transition-colors', !n.isRead && 'bg-primary/5')}>
                  <div className={cn('w-9 h-9 rounded-full flex items-center justify-center text-lg shrink-0 mt-0.5', icon.color)}>
                    {icon.emoji}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={cn('text-sm', !n.isRead && 'font-semibold')}>{n.title}</p>
                    <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>
                    <p className="text-xs text-muted-foreground mt-1">{formatRelative(n.createdAt)}</p>
                  </div>
                  {!n.isRead && (
                    <div className="w-2 h-2 bg-primary rounded-full shrink-0 mt-2" />
                  )}
                </div>
              )

              return n.link ? (
                <Link key={n.id} href={n.link} onClick={() => markAsRead(n.id)}>
                  {content}
                </Link>
              ) : (
                <div key={n.id}>{content}</div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
