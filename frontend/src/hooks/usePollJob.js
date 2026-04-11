import { useCallback, useRef } from 'react'
import { jobApi } from '../api/client.js'

/**
 * usePollJob — polls a backend job ID until it reaches a terminal state.
 *
 * Each call to poll() creates its own independent interval so concurrent
 * polls (e.g. Sync All firing 8 areas at once) don't overwrite each other.
 *
 * Terminal states handled:
 *   complete   → onComplete(job)
 *   failed     → onError(job.error)
 *   unavailable → onUnavailable(job) — e.g. Intune without a licence
 */
export function usePollJob() {
  // Track all active intervals so we can cancel all if needed
  const activeIntervals = useRef(new Set())

  const poll = useCallback((jobId, onComplete, onError, onUnavailable) => {
    const interval = setInterval(async () => {
      try {
        const job = await jobApi.get(jobId)

        if (job.status === 'complete') {
          clearInterval(interval)
          activeIntervals.current.delete(interval)
          onComplete?.(job.result ?? job)
        } else if (job.status === 'failed') {
          clearInterval(interval)
          activeIntervals.current.delete(interval)
          onError?.(job.error || 'Sync failed')
        } else if (job.status === 'unavailable') {
          clearInterval(interval)
          activeIntervals.current.delete(interval)
          // Treat as a soft-complete — area just isn't licenced, not an error
          onUnavailable?.(job.error || 'Area unavailable on this licence tier')
          onComplete?.(job.result ?? job)  // resolve so the spinner stops
        }
        // 'pending' and 'running' → keep polling
      } catch {
        // Network error — keep polling, will self-clear on next terminal state
      }
    }, 2500)

    activeIntervals.current.add(interval)
    return interval
  }, [])

  const cancelAll = useCallback(() => {
    for (const interval of activeIntervals.current) clearInterval(interval)
    activeIntervals.current.clear()
  }, [])

  return { poll, cancelAll }
}
