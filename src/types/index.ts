import { GlobalRole, ProjectRole, IssueType, Priority, SprintStatus, StatusCategory, NotifType } from '@prisma/client'

export type { GlobalRole, ProjectRole, IssueType, Priority, SprintStatus, StatusCategory, NotifType }

// ─── Augment NextAuth types ────────────────────────────────────────────────────
declare module 'next-auth' {
  interface User {
    id: string
    role: string
    avatarUrl?: string
    avatarColor: string
  }
  interface Session {
    user: {
      id: string
      name: string
      email: string
      role: string
      avatarUrl?: string
      avatarColor: string
    }
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string
    role: string
    avatarUrl?: string
    avatarColor: string
  }
}

// ─── User ─────────────────────────────────────────────────────────────────────

export interface UserSummary {
  id: string
  name: string
  email: string
  avatarUrl?: string | null
  avatarColor: string
}

export interface UserFull extends UserSummary {
  role: GlobalRole
  isActive: boolean
  jobTitle?: string | null
  department?: string | null
  bio?: string | null
  timezone: string
  createdAt: Date
}

// ─── Project ──────────────────────────────────────────────────────────────────

export interface ProjectSummary {
  id: string
  key: string
  name: string
  description?: string | null
  avatarColor: string
  avatarUrl?: string | null
  isArchived: boolean
  createdAt: Date
  _count?: {
    issues: number
    members: number
    sprints: number
  }
}

export interface ProjectFull extends ProjectSummary {
  owner: UserSummary
  members: ProjectMemberFull[]
  columns: BoardColumnFull[]
  workflowStatuses: WorkflowStatusFull[]
}

export interface ProjectMemberFull {
  id: string
  userId: string
  projectId: string
  role: ProjectRole
  joinedAt: Date
  user: UserSummary
}

// ─── Workflow ─────────────────────────────────────────────────────────────────

export interface WorkflowStatusFull {
  id: string
  projectId: string
  name: string
  category: StatusCategory
  color: string
  order: number
  isDefault: boolean
}

export interface WorkflowTransitionFull {
  id: string
  fromStatusId: string
  toStatusId: string
  name: string
  requiredRole?: ProjectRole | null
  fromStatus: WorkflowStatusFull
  toStatus: WorkflowStatusFull
}

// ─── Board ────────────────────────────────────────────────────────────────────

export interface BoardColumnFull {
  id: string
  projectId: string
  name: string
  order: number
  color: string
  wipLimit?: number | null
  statusId: string
  status: WorkflowStatusFull
  issues?: IssueSummary[]
  _count?: { issues: number }
}

// ─── Sprint ───────────────────────────────────────────────────────────────────

export interface SprintFull {
  id: string
  projectId: string
  name: string
  goal?: string | null
  status: SprintStatus
  startDate?: Date | null
  endDate?: Date | null
  completedAt?: Date | null
  order: number
  createdAt: Date
  _count?: { issues: number }
  issues?: IssueSummary[]
}

// ─── Issue ────────────────────────────────────────────────────────────────────

export interface IssueSummary {
  id: string
  key: string
  projectId: string
  sprintId?: string | null
  columnId?: string | null
  parentId?: string | null
  epicId?: string | null
  statusId: string
  type: IssueType
  priority: Priority
  title: string
  storyPoints?: number | null
  assigneeId?: string | null
  reporterId: string
  dueDate?: Date | null
  order: number
  createdAt: Date
  updatedAt: Date
  status: WorkflowStatusFull
  assignee?: UserSummary | null
  reporter: UserSummary
  labels?: LabelFull[]
  _count?: { subtasks: number; comments: number }
}

export interface IssueFull extends IssueSummary {
  description?: string | null
  sprint?: SprintFull | null
  column?: BoardColumnFull | null
  parent?: IssueSummary | null
  subtasks?: IssueSummary[]
  epic?: IssueSummary | null
  epicIssues?: IssueSummary[]
  comments?: CommentFull[]
  attachments?: AttachmentFull[]
  watchers?: UserSummary[]
}

// ─── Labels ───────────────────────────────────────────────────────────────────

export interface LabelFull {
  id: string
  projectId: string
  name: string
  color: string
}

// ─── Comments ─────────────────────────────────────────────────────────────────

export interface CommentFull {
  id: string
  issueId: string
  authorId: string
  body: string
  isEdited: boolean
  createdAt: Date
  updatedAt: Date
  author: UserSummary
}

// ─── Attachments ──────────────────────────────────────────────────────────────

export interface AttachmentFull {
  id: string
  issueId: string
  uploaderId: string
  filename: string
  mimeType: string
  size: number
  url: string
  createdAt: Date
  uploader: UserSummary
}

// ─── Notifications ────────────────────────────────────────────────────────────

export interface NotificationFull {
  id: string
  userId: string
  type: NotifType
  title: string
  body: string
  link?: string | null
  isRead: boolean
  createdAt: Date
}

// ─── Audit Logs ───────────────────────────────────────────────────────────────

export interface AuditLogFull {
  id: string
  actorId: string
  projectId?: string | null
  issueId?: string | null
  entityType: string
  entityId: string
  action: string
  changes?: Record<string, unknown> | null
  createdAt: Date
  actor: UserSummary
}

// ─── API Response ─────────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data: T
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

// ─── Board State ──────────────────────────────────────────────────────────────

export interface BoardState {
  columns: BoardColumnFull[]
  sprint?: SprintFull | null
}

// ─── Filter State ─────────────────────────────────────────────────────────────

export interface IssueFilters {
  search?: string
  sprintId?: string
  assigneeId?: string
  reporterId?: string
  priority?: Priority[]
  type?: IssueType[]
  statusId?: string[]
  labelId?: string[]
}
