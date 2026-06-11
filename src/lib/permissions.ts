import { GlobalRole, ProjectRole } from '@prisma/client'

// Permission actions
export type Action =
  | 'project:create'
  | 'project:read'
  | 'project:update'
  | 'project:delete'
  | 'project:manage_members'
  | 'board:manage_columns'
  | 'sprint:create'
  | 'sprint:start'
  | 'sprint:complete'
  | 'sprint:delete'
  | 'issue:create'
  | 'issue:read'
  | 'issue:update'
  | 'issue:delete'
  | 'issue:assign'
  | 'issue:transition'
  | 'comment:create'
  | 'comment:update_own'
  | 'comment:delete_own'
  | 'comment:delete_any'
  | 'workflow:manage'
  | 'user:manage'
  | 'admin:access'

// Global role permissions
const GLOBAL_PERMISSIONS: Record<GlobalRole, Set<Action>> = {
  SUPER_ADMIN: new Set<Action>([
    'project:create', 'project:read', 'project:update', 'project:delete',
    'project:manage_members', 'board:manage_columns', 'sprint:create', 'sprint:start',
    'sprint:complete', 'sprint:delete', 'issue:create', 'issue:read', 'issue:update',
    'issue:delete', 'issue:assign', 'issue:transition', 'comment:create', 'comment:update_own',
    'comment:delete_own', 'comment:delete_any', 'workflow:manage', 'user:manage', 'admin:access',
  ]),
  ADMIN: new Set<Action>([
    'project:create', 'project:read', 'project:update', 'project:delete',
    'project:manage_members', 'board:manage_columns', 'sprint:create', 'sprint:start',
    'sprint:complete', 'sprint:delete', 'issue:create', 'issue:read', 'issue:update',
    'issue:delete', 'issue:assign', 'issue:transition', 'comment:create', 'comment:update_own',
    'comment:delete_own', 'comment:delete_any', 'workflow:manage', 'user:manage', 'admin:access',
  ]),
  MEMBER: new Set<Action>([
    'project:read', 'issue:create', 'issue:read', 'issue:update', 'issue:transition',
    'comment:create', 'comment:update_own', 'comment:delete_own',
  ]),
}

// Project-level role permissions
const PROJECT_PERMISSIONS: Record<ProjectRole, Set<Action>> = {
  OWNER: new Set<Action>([
    'project:read', 'project:update', 'project:delete', 'project:manage_members',
    'board:manage_columns', 'sprint:create', 'sprint:start', 'sprint:complete', 'sprint:delete',
    'issue:create', 'issue:read', 'issue:update', 'issue:delete', 'issue:assign', 'issue:transition',
    'comment:create', 'comment:update_own', 'comment:delete_own', 'comment:delete_any', 'workflow:manage',
  ]),
  ADMIN: new Set<Action>([
    'project:read', 'project:update', 'project:manage_members', 'board:manage_columns',
    'sprint:create', 'sprint:start', 'sprint:complete', 'sprint:delete',
    'issue:create', 'issue:read', 'issue:update', 'issue:delete', 'issue:assign', 'issue:transition',
    'comment:create', 'comment:update_own', 'comment:delete_own', 'comment:delete_any', 'workflow:manage',
  ]),
  SCRUM_MASTER: new Set<Action>([
    'project:read', 'board:manage_columns', 'sprint:create', 'sprint:start', 'sprint:complete',
    'issue:create', 'issue:read', 'issue:update', 'issue:assign', 'issue:transition',
    'comment:create', 'comment:update_own', 'comment:delete_own',
  ]),
  MEMBER: new Set<Action>([
    'project:read', 'issue:create', 'issue:read', 'issue:update', 'issue:transition',
    'comment:create', 'comment:update_own', 'comment:delete_own',
  ]),
  VIEWER: new Set<Action>(['project:read', 'issue:read']),
}

export interface SessionUser {
  id: string
  role: string
}

export function hasGlobalPermission(user: SessionUser, action: Action): boolean {
  const role = user.role as GlobalRole
  return GLOBAL_PERMISSIONS[role]?.has(action) ?? false
}

export function hasProjectPermission(projectRole: ProjectRole | null | undefined, action: Action): boolean {
  if (!projectRole) return false
  return PROJECT_PERMISSIONS[projectRole]?.has(action) ?? false
}

export function canPerformAction(
  user: SessionUser,
  action: Action,
  projectRole?: ProjectRole | null,
): boolean {
  // Super admin and admin can do anything
  if (hasGlobalPermission(user, action)) return true
  // Check project-level role
  if (projectRole) return hasProjectPermission(projectRole, action)
  return false
}

export function assertPermission(
  user: SessionUser | null | undefined,
  action: Action,
  projectRole?: ProjectRole | null,
): void {
  if (!user) throw new Error('UNAUTHORIZED')
  if (!canPerformAction(user, action, projectRole)) {
    throw new Error('FORBIDDEN')
  }
}
