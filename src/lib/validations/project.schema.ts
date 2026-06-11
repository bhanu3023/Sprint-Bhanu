import { z } from 'zod'

export const createProjectSchema = z.object({
  key: z
    .string()
    .min(2, 'Key must be 2–10 characters')
    .max(10, 'Key must be 2–10 characters')
    .regex(/^[A-Z][A-Z0-9]*$/, 'Key must be uppercase letters and numbers only'),
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  description: z.string().max(500).optional(),
  avatarColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
})

export const updateProjectSchema = createProjectSchema.partial().omit({ key: true })

export const addMemberSchema = z.object({
  userId: z.string().cuid(),
  role: z.enum(['OWNER', 'ADMIN', 'SCRUM_MASTER', 'MEMBER', 'VIEWER']),
})

export const updateMemberSchema = z.object({
  role: z.enum(['OWNER', 'ADMIN', 'SCRUM_MASTER', 'MEMBER', 'VIEWER']),
})

export const createColumnSchema = z.object({
  name: z.string().min(1).max(50),
  statusId: z.string().cuid(),
  color: z.string().optional(),
  wipLimit: z.number().int().positive().optional(),
})

export const updateColumnSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  order: z.number().int().min(0).optional(),
  color: z.string().optional(),
  wipLimit: z.number().int().positive().nullable().optional(),
})

export type CreateProjectInput = z.infer<typeof createProjectSchema>
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>
export type AddMemberInput = z.infer<typeof addMemberSchema>
