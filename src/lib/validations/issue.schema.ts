import { z } from 'zod'

const emptyToNull = (v: unknown) => (v === '' || v === undefined ? null : v)

export const createIssueSchema = z.object({
  projectKey: z.string().min(1),
  sprintId: z.preprocess(emptyToNull, z.string().cuid().optional().nullable()),
  parentId: z.preprocess(emptyToNull, z.string().cuid().optional().nullable()),
  epicId: z.preprocess(emptyToNull, z.string().cuid().optional().nullable()),
  type: z.enum(['EPIC', 'STORY', 'TASK', 'BUG', 'SUBTASK']).default('TASK'),
  priority: z.enum(['HIGHEST', 'HIGH', 'MEDIUM', 'LOW', 'LOWEST']).default('MEDIUM'),
  title: z.string().min(1, 'Title is required').max(255),
  description: z.preprocess(emptyToNull, z.string().max(10000).optional().nullable()),
  assigneeId: z.preprocess(emptyToNull, z.string().cuid().optional().nullable()),
  storyPoints: z.preprocess(
    (v) => (v === '' || v === null || (typeof v === 'number' && isNaN(v)) ? null : v),
    z.number().int().min(0).max(100).optional().nullable()
  ),
  dueDate: z.preprocess(emptyToNull, z.string().optional().nullable()),
  labelIds: z.array(z.string().cuid()).optional(),
})

export const updateIssueSchema = z.object({
  sprintId: z.preprocess(emptyToNull, z.string().cuid().optional().nullable()),
  columnId: z.preprocess(emptyToNull, z.string().cuid().optional().nullable()),
  type: z.enum(['EPIC', 'STORY', 'TASK', 'BUG', 'SUBTASK']).optional(),
  priority: z.enum(['HIGHEST', 'HIGH', 'MEDIUM', 'LOW', 'LOWEST']).optional(),
  title: z.string().min(1).max(255).optional(),
  description: z.preprocess(emptyToNull, z.string().max(10000).optional().nullable()),
  assigneeId: z.preprocess(emptyToNull, z.string().cuid().optional().nullable()),
  storyPoints: z.preprocess(
    (v) => (v === '' || v === null || (typeof v === 'number' && isNaN(v)) ? null : v),
    z.number().int().min(0).max(100).optional().nullable()
  ),
  dueDate: z.preprocess(emptyToNull, z.string().optional().nullable()),
  labelIds: z.array(z.string().cuid()).optional(),
  epicId: z.preprocess(emptyToNull, z.string().cuid().optional().nullable()),
  order: z.number().optional(),
})

export const transitionIssueSchema = z.object({
  statusId: z.string().cuid(),
  columnId: z.string().cuid().optional(),
})

export const createCommentSchema = z.object({
  body: z.string().min(1, 'Comment cannot be empty').max(5000),
})

export const updateCommentSchema = z.object({
  body: z.string().min(1).max(5000),
})

export const reorderBoardSchema = z.object({
  issueId: z.string().cuid(),
  sourceColumnId: z.string().cuid(),
  destinationColumnId: z.string().cuid(),
  newOrder: z.number(),
  statusId: z.string().cuid(),
})

export type CreateIssueInput = z.infer<typeof createIssueSchema>
export type UpdateIssueInput = z.infer<typeof updateIssueSchema>
