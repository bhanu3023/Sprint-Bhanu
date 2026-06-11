'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'react-hot-toast'
import { Clock, Save, RotateCcw, ShieldAlert, Info } from 'lucide-react'

const slaSchema = z.object({
  name: z.string().min(1).max(100),
  highestResponseHours: z.coerce.number().int().positive(),
  highResponseHours: z.coerce.number().int().positive(),
  mediumResponseHours: z.coerce.number().int().positive(),
  lowResponseHours: z.coerce.number().int().positive(),
  lowestResponseHours: z.coerce.number().int().positive(),
  highestResolutionHours: z.coerce.number().int().positive(),
  highResolutionHours: z.coerce.number().int().positive(),
  mediumResolutionHours: z.coerce.number().int().positive(),
  lowResolutionHours: z.coerce.number().int().positive(),
  lowestResolutionHours: z.coerce.number().int().positive(),
})

type SlaForm = z.infer<typeof slaSchema>

interface SlaPolicy {
  id: string
  name: string
  highestResponseHours: number
  highResponseHours: number
  mediumResponseHours: number
  lowResponseHours: number
  lowestResponseHours: number
  highestResolutionHours: number
  highResolutionHours: number
  mediumResolutionHours: number
  lowResolutionHours: number
  lowestResolutionHours: number
}

interface Props {
  projectKey: string
  initialPolicy: SlaPolicy | null
}

const DEFAULTS: SlaForm = {
  name: 'Default SLA',
  highestResponseHours: 1,
  highResponseHours: 4,
  mediumResponseHours: 8,
  lowResponseHours: 24,
  lowestResponseHours: 72,
  highestResolutionHours: 4,
  highResolutionHours: 24,
  mediumResolutionHours: 72,
  lowResolutionHours: 168,
  lowestResolutionHours: 336,
}

const PRIORITIES = [
  { key: 'highest', label: 'Highest', color: 'text-red-600' },
  { key: 'high', label: 'High', color: 'text-orange-500' },
  { key: 'medium', label: 'Medium', color: 'text-yellow-500' },
  { key: 'low', label: 'Low', color: 'text-blue-500' },
  { key: 'lowest', label: 'Lowest', color: 'text-slate-400' },
] as const

function hoursToDisplay(h: number): string {
  if (h < 24) return `${h}h`
  return `${h / 24}d`
}

export function SlaConfigView({ projectKey, initialPolicy }: Props) {
  const [saving, setSaving] = useState(false)
  const [policy, setPolicy] = useState<SlaPolicy | null>(initialPolicy)

  const { register, handleSubmit, reset, formState: { errors, isDirty } } = useForm<SlaForm>({
    resolver: zodResolver(slaSchema),
    defaultValues: policy ?? DEFAULTS,
  })

  const onSubmit = async (data: SlaForm) => {
    setSaving(true)
    try {
      const res = await fetch(`/api/projects/${projectKey}/sla`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error('Failed to save SLA policy')
      const json = await res.json()
      setPolicy(json.data)
      reset(json.data)
      toast.success('SLA policy saved')
    } catch (e) {
      toast.error('Failed to save SLA policy')
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => reset(DEFAULTS)

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
          <ShieldAlert className="w-5 h-5 text-amber-600 dark:text-amber-400" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">SLA Policy</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Define response and resolution time targets per priority. SLA deadlines are automatically set when issues are created.
          </p>
        </div>
      </div>

      {!policy && (
        <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
          <Info className="w-4 h-4 shrink-0" />
          No SLA policy configured. Save a policy to start tracking SLA on new issues.
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <div>
          <label className="block text-sm font-medium mb-1">Policy Name</label>
          <input
            {...register('name')}
            className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
            placeholder="e.g. Standard SLA"
          />
          {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name.message}</p>}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Response Time */}
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-blue-500" />
              <h3 className="text-sm font-semibold">Response Time Targets</h3>
            </div>
            <p className="text-xs text-muted-foreground">Time to first response / acknowledgement</p>
            {PRIORITIES.map((p) => (
              <div key={p.key} className="flex items-center justify-between gap-3">
                <span className={`text-xs font-medium w-16 ${p.color}`}>{p.label}</span>
                <div className="flex items-center gap-1.5 flex-1">
                  <input
                    type="number"
                    min="1"
                    {...register(`${p.key}ResponseHours` as keyof SlaForm)}
                    className="w-20 px-2 py-1 text-sm bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary/40"
                  />
                  <span className="text-xs text-muted-foreground">hours</span>
                </div>
              </div>
            ))}
          </div>

          {/* Resolution Time */}
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-green-500" />
              <h3 className="text-sm font-semibold">Resolution Time Targets</h3>
            </div>
            <p className="text-xs text-muted-foreground">Time to fully resolve/close the issue</p>
            {PRIORITIES.map((p) => (
              <div key={p.key} className="flex items-center justify-between gap-3">
                <span className={`text-xs font-medium w-16 ${p.color}`}>{p.label}</span>
                <div className="flex items-center gap-1.5 flex-1">
                  <input
                    type="number"
                    min="1"
                    {...register(`${p.key}ResolutionHours` as keyof SlaForm)}
                    className="w-20 px-2 py-1 text-sm bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary/40"
                  />
                  <span className="text-xs text-muted-foreground">hours</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving || !isDirty}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving…' : 'Save Policy'}
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground border border-border rounded-lg hover:bg-muted transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            Reset to Defaults
          </button>
        </div>
      </form>

      {/* Reference table */}
      <div className="bg-muted/30 rounded-xl p-4">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Common SLA Templates</h4>
        <div className="grid grid-cols-3 gap-3 text-xs">
          <div className="space-y-1">
            <p className="font-medium">Critical Support</p>
            <p className="text-muted-foreground">Highest: 1h / 4h</p>
            <p className="text-muted-foreground">High: 4h / 24h</p>
          </div>
          <div className="space-y-1">
            <p className="font-medium">Standard Support</p>
            <p className="text-muted-foreground">Highest: 4h / 24h</p>
            <p className="text-muted-foreground">High: 8h / 72h</p>
          </div>
          <div className="space-y-1">
            <p className="font-medium">Best Effort</p>
            <p className="text-muted-foreground">Highest: 8h / 48h</p>
            <p className="text-muted-foreground">High: 24h / 5d</p>
          </div>
        </div>
      </div>
    </div>
  )
}
