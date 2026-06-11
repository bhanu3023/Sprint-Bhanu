import { z } from 'zod'

const emptyToNull = (v: unknown) => (v === '' || v === undefined ? null : v)

export const createSprintSchema = z.object({
  projectKey: z.string().min(1),
  name: z.string().min(1, 'Sprint name is required').max(100),
  goal: z.preprocess(emptyToNull, z.string().max(500).optional().nullable()),
  startDate: z.preprocess(emptyToNull, z.string().optional().nullable()),
  endDate: z.preprocess(emptyToNull, z.string().optional().nullable()),
})

export const updateSprintSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  goal: z.preprocess(emptyToNull, z.string().max(500).optional().nullable()),
  startDate: z.preprocess(emptyToNull, z.string().optional().nullable()),
  endDate: z.preprocess(emptyToNull, z.string().optional().nullable()),
})

export const startSprintSchema = z.object({
  startDate: z.string(),
  endDate: z.string(),
})

export const completeSprintSchema = z.object({
  moveToSprintId: z.preprocess(emptyToNull, z.string().cuid().optional().nullable()),
})

export type CreateSprintInput = z.infer<typeof createSprintSchema>
export type UpdateSprintInput = z.infer<typeof updateSprintSchema>
