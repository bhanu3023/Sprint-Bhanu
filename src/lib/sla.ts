import { Priority } from '@prisma/client'

export interface SlaPolicy {
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

export function getResponseHours(policy: SlaPolicy, priority: Priority): number {
  switch (priority) {
    case 'HIGHEST': return policy.highestResponseHours
    case 'HIGH': return policy.highResponseHours
    case 'MEDIUM': return policy.mediumResponseHours
    case 'LOW': return policy.lowResponseHours
    case 'LOWEST': return policy.lowestResponseHours
  }
}

export function getResolutionHours(policy: SlaPolicy, priority: Priority): number {
  switch (priority) {
    case 'HIGHEST': return policy.highestResolutionHours
    case 'HIGH': return policy.highResolutionHours
    case 'MEDIUM': return policy.mediumResolutionHours
    case 'LOW': return policy.lowResolutionHours
    case 'LOWEST': return policy.lowestResolutionHours
  }
}

export function calcDeadline(createdAt: Date, hours: number): Date {
  return new Date(createdAt.getTime() + hours * 60 * 60 * 1000)
}

export type SlaStatus = 'ok' | 'warning' | 'breached' | 'met'

export function getSlaStatus(deadline: Date | null, breached: boolean, metAt?: Date | null): SlaStatus {
  if (metAt) return 'met'
  if (breached) return 'breached'
  if (!deadline) return 'ok'
  const now = new Date()
  const diff = deadline.getTime() - now.getTime()
  const hoursLeft = diff / (1000 * 60 * 60)
  if (hoursLeft < 0) return 'breached'
  if (hoursLeft < 2) return 'warning'
  return 'ok'
}

export function formatTimeLeft(deadline: Date | null): string {
  if (!deadline) return ''
  const now = new Date()
  const diff = deadline.getTime() - now.getTime()
  const abs = Math.abs(diff)
  const hours = Math.floor(abs / (1000 * 60 * 60))
  const minutes = Math.floor((abs % (1000 * 60 * 60)) / (1000 * 60))

  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    return diff < 0 ? `-${days}d` : `${days}d`
  }
  if (hours > 0) return diff < 0 ? `-${hours}h ${minutes}m` : `${hours}h ${minutes}m`
  return diff < 0 ? `-${minutes}m` : `${minutes}m`
}
