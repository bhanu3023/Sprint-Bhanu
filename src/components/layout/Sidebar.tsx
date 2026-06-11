'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import {
  LayoutDashboard, FolderKanban, Users, Settings, Bell, ChevronDown, ChevronRight,
  BarChart3, BookOpen, Zap, Shield, Plus, ArrowLeft, ShieldAlert,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useState } from 'react'

interface SidebarProps {
  projectKey?: string
  projectName?: string
}

export function Sidebar({ projectKey, projectName }: SidebarProps) {
  const pathname = usePathname()
  const { data: session } = useSession()
  const [projectNavOpen, setProjectNavOpen] = useState(true)
  const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(session?.user?.role ?? '')

  const globalNav = [
    { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { href: '/projects', icon: FolderKanban, label: 'Projects' },
    { href: '/users', icon: Users, label: 'People' },
    { href: '/notifications', icon: Bell, label: 'Notifications' },
    ...(isAdmin ? [{ href: '/admin', icon: Shield, label: 'Admin' }] : []),
  ]

  const projectNav = projectKey ? [
    { href: `/projects/${projectKey}/board`, icon: LayoutDashboard, label: 'Board' },
    { href: `/projects/${projectKey}/backlog`, icon: BookOpen, label: 'Backlog' },
    { href: `/projects/${projectKey}/sprints`, icon: Zap, label: 'Sprints' },
    { href: `/projects/${projectKey}/issues`, icon: FolderKanban, label: 'Issues' },
    { href: `/projects/${projectKey}/reports`, icon: BarChart3, label: 'Reports' },
    { href: `/projects/${projectKey}/sla`, icon: ShieldAlert, label: 'SLA' },
    { href: `/projects/${projectKey}/settings`, icon: Settings, label: 'Settings' },
  ] : []

  return (
    <aside className="w-64 h-screen flex flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border fixed left-0 top-0 z-30">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 py-4 border-b border-sidebar-border">
        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shrink-0">
          <svg viewBox="0 0 24 24" className="w-5 h-5 text-white fill-current">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" fill="none"/>
          </svg>
        </div>
        <Link href="/dashboard" className="font-bold text-white text-lg tracking-tight hover:text-blue-300 transition-colors">
          SprintBoard
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin py-2">
        {/* Global Nav */}
        <nav className="px-2 space-y-0.5">
          {globalNav.map(({ href, icon: Icon, label }) => {
            const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href))
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                  active
                    ? 'bg-sidebar-accent text-white'
                    : 'text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-white/10',
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {label}
              </Link>
            )
          })}
        </nav>

        {/* Project Nav */}
        {projectKey && (
          <div className="mt-4 border-t border-sidebar-border pt-4">
            <button
              onClick={() => setProjectNavOpen((v) => !v)}
              className="flex items-center justify-between w-full px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/50 hover:text-sidebar-foreground/80 transition-colors"
            >
              <span className="truncate">{projectName ?? projectKey}</span>
              {projectNavOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </button>

            {projectNavOpen && (
              <nav className="px-2 space-y-0.5 mt-1">
                {projectNav.map(({ href, icon: Icon, label }) => {
                  const active = pathname === href || (pathname.startsWith(href) && href !== `/projects/${projectKey}`)
                  return (
                    <Link
                      key={href}
                      href={href}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                        active
                          ? 'bg-sidebar-accent text-white'
                          : 'text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-white/10',
                      )}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      {label}
                    </Link>
                  )
                })}
              </nav>
            )}

            <div className="px-3 mt-2">
              <Link
                href="/projects"
                className="flex items-center gap-2 text-xs text-sidebar-foreground/50 hover:text-sidebar-foreground/80 transition-colors"
              >
                <ArrowLeft className="w-3 h-3" /> All Projects
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* Create Quick Action */}
      <div className="p-3 border-t border-sidebar-border">
        <Link
          href="/projects"
          className="flex items-center justify-center gap-2 w-full py-2 px-3 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-md transition-colors"
        >
          <Plus className="w-4 h-4" /> Create Project
        </Link>
      </div>
    </aside>
  )
}
