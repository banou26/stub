import type { FknBackend } from '../utils/fkn-backend'

import { cloud, permissions } from '@fkn/lib'

import { PRIME_PLAYER_REASON, primeDomainsFor } from '../sources/amazon/session'
import { CRUNCHYROLL_DOMAINS, CRUNCHYROLL_PLAYER_REASON } from '../sources/crunchyroll/session'
import { CONNECTED_KEY, connectedSites } from './connections'

/** Maximum hosts accepted per host group on FKN's cloud consent card. */
export const MAX_CLOUD_HOSTS = 16

/** One evaluation permission request submitted into the shared batch. */
export type EvaluationAsk = {
  hosts: readonly string[]
  reason: string
  backend: FknBackend
}

/** One deduplicated host-group ask forwarded to `@fkn/lib`. */
export type BatchRequestItem = {
  category: 'evaluation'
  hosts: string[]
  reason: string
}

/** Backend-specific batch requester; returning `undefined` lets callers fall back to `attachFrame`. */
export type BatchRequester = (
  backend: FknBackend,
  requests: readonly BatchRequestItem[],
) => Promise<readonly { allow: boolean }[] | undefined>

/** Upfront batcher that combines concurrent evaluation asks across frames into one prompt. */
export type PermissionBatcher = {
  /** Hold flushing until the returned release callback runs (or `holdMaxMs` elapses). */
  hold: () => () => void
  /** Whether any caller currently holds the batch open waiting for siblings. */
  isHeld: () => boolean
  /**
   * Queue an evaluation permission ask for `entry.backend`.
   * Resolves to `true`/`false` when decided in a multi-site batch, or `undefined` when skipped or unavailable.
   */
  ask: (entry: EvaluationAsk) => Promise<boolean | undefined>
}

type PendingEntry = {
  hosts: string[]
  reason: string
  backend: FknBackend
  resolve: (granted: boolean | undefined) => void
}

const hostKeyOf = (hosts: readonly string[]): string =>
  [...new Set(hosts.map(host => host.trim().toLowerCase()).filter(Boolean))].sort().join(',')

export const createPermissionBatcher = ({
  request,
  windowMs = 80,
  holdMaxMs = 1200,
}: {
  request: BatchRequester
  windowMs?: number
  holdMaxMs?: number
}): PermissionBatcher => {
  let holds = 0
  let holdTimer: ReturnType<typeof setTimeout> | undefined
  let flushTimer: ReturnType<typeof setTimeout> | undefined
  const pending: PendingEntry[] = []

  const clearTimers = () => {
    if (holdTimer !== undefined) {
      clearTimeout(holdTimer)
      holdTimer = undefined
    }
    if (flushTimer !== undefined) {
      clearTimeout(flushTimer)
      flushTimer = undefined
    }
  }

  const scheduleFlush = (delayMs: number) => {
    if (flushTimer !== undefined) return
    flushTimer = setTimeout(flush, delayMs)
  }

  const ensureHoldTimer = () => {
    if (holdTimer !== undefined) return
    holdTimer = setTimeout(flush, holdMaxMs)
  }

  const flush = () => {
    clearTimers()
    if (!pending.length) return
    const batch = pending.splice(0, pending.length)

    const byBackend = new Map<FknBackend, PendingEntry[]>()
    for (const entry of batch) {
      const list = byBackend.get(entry.backend)
      if (list) list.push(entry)
      else byBackend.set(entry.backend, [entry])
    }

    for (const [backend, entries] of byBackend) {
      const groups: { hosts: string[], reason: string, waiters: PendingEntry[] }[] = []
      const byKey = new Map<string, number>()

      for (const entry of entries) {
        const key = hostKeyOf(entry.hosts)
        const index = byKey.get(key)
        if (index === undefined) {
          byKey.set(key, groups.length)
          groups.push({ hosts: entry.hosts, reason: entry.reason.trim(), waiters: [entry] })
        } else {
          const group = groups[index]!
          group.waiters.push(entry)
          if (!group.reason && entry.reason.trim()) group.reason = entry.reason.trim()
        }
      }

      if (entries.length <= 1 && groups.length <= 1) {
        for (const entry of entries) entry.resolve(undefined)
        continue
      }

      const items: BatchRequestItem[] = groups.map(({ hosts, reason }) => ({
        category: 'evaluation',
        hosts,
        reason,
      }))

      void Promise.resolve()
        .then(() => request(backend, items))
        .then(
          answers => {
            if (!Array.isArray(answers) || answers.length !== groups.length) {
              for (const entry of entries) entry.resolve(undefined)
              return
            }
            groups.forEach((group, index) => {
              const allow = Boolean(answers[index]?.allow)
              for (const waiter of group.waiters) waiter.resolve(allow)
            })
          },
          () => {
            for (const entry of entries) entry.resolve(undefined)
          },
        )
    }
  }

  const hold = () => {
    holds += 1
    let active = true
    return () => {
      if (!active) return
      active = false
      holds = Math.max(0, holds - 1)
      if (holds === 0 && pending.length > 0) {
        if (holdTimer !== undefined) {
          clearTimeout(holdTimer)
          holdTimer = undefined
        }
        // Defer past the render commit so effects emitted on release join the same batch.
        scheduleFlush(windowMs)
      }
    }
  }

  const isHeld = () => holds > 0

  const ask = (entry: EvaluationAsk): Promise<boolean | undefined> =>
    new Promise(resolve => {
      const hosts = entry.backend === 'cloud' ? entry.hosts.slice(0, MAX_CLOUD_HOSTS) : [...entry.hosts]
      pending.push({ hosts, reason: entry.reason, backend: entry.backend, resolve })
      if (holds > 0) ensureHoldTimer()
      else scheduleFlush(windowMs)
    })

  return { hold, isHeld, ask }
}

const requestBatch: BatchRequester = async (backend, requests) => {
  if (backend === 'cloud') {
    if (typeof cloud?.permissions?.request !== 'function') return undefined
    return await cloud.permissions.request(requests)
  }
  if (typeof permissions?.request !== 'function') return undefined
  return await permissions.request([...requests])
}

/** Shared batcher coordinating watch player and connected tracker evaluation prompts. */
export const evaluationPermissionBatch = createPermissionBatcher({ request: requestBatch })

/** Upfront evaluation permission scope for a built-in watch player origin, if any. */
export const watchPlayerPermission = (
  origin: string | undefined,
  url: string | null | undefined,
): { hosts: string[], reason: string } | undefined => {
  if (origin === 'amazon' && url) return { hosts: primeDomainsFor(url), reason: PRIME_PLAYER_REASON }
  if (origin === 'cr' && url) return { hosts: [...CRUNCHYROLL_DOMAINS], reason: CRUNCHYROLL_PLAYER_REASON }
  return undefined
}

/** Whether any tracker site is connected on this device in `storage`. */
export const hasConnectedSites = (storage?: Pick<Storage, 'getItem'> | null): boolean => {
  try {
    const store = storage ?? globalThis.localStorage
    return store ? connectedSites(store.getItem(CONNECTED_KEY)).length > 0 : false
  } catch {
    return false
  }
}
