import { useCallback, useEffect, useRef, useState } from 'react'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import type { DashboardCollaborationMessage, DashboardCollaborationRun } from './multiagent-task'
import { translate } from '@/i18n/i18n'

export function useDashboardCollaboration(args: {
  cards: DashboardCard[]
  onResolveCurrentRun?: (card: DashboardCard) => Promise<DashboardCollaborationRun | null>
}): {
  updatesByPaneKey: Record<string, DashboardCollaborationMessage[]>
  errorsByPaneKey: Record<string, string>
  trackRun: (run: DashboardCollaborationRun) => void
} {
  const { cards, onResolveCurrentRun } = args
  const [runs, setRuns] = useState<DashboardCollaborationRun[]>([])
  const [updatesByPaneKey, setUpdatesByPaneKey] = useState<
    Record<string, DashboardCollaborationMessage[]>
  >({})
  const [errorsByPaneKey, setErrorsByPaneKey] = useState<Record<string, string>>({})
  const candidatesRef = useRef<DashboardCard[]>([])
  candidatesRef.current = cards.filter(
    (card) =>
      card.bucket === 'working' &&
      card.parentPaneKey === undefined &&
      card.ptyId !== null &&
      card.leafId !== null
  )
  const candidateKey = candidatesRef.current
    .map((card) => `${card.paneKey}:${card.worktreeId}:${card.executionHostId ?? ''}`)
    .join('|')

  const trackRun = useCallback((run: DashboardCollaborationRun) => {
    setRuns((previous) => [...previous.filter((item) => item.paneKey !== run.paneKey), run])
    setUpdatesByPaneKey((previous) => {
      const next = { ...previous }
      delete next[run.paneKey]
      return next
    })
    setErrorsByPaneKey((previous) => {
      const next = { ...previous }
      delete next[run.paneKey]
      return next
    })
  }, [])

  useEffect(() => {
    if (!onResolveCurrentRun) {
      return
    }
    let active = true
    let resolving = false
    const resolveRuns = async (): Promise<void> => {
      if (resolving || document.visibilityState === 'hidden') {
        return
      }
      resolving = true
      const results = await Promise.all(
        candidatesRef.current.map(async (card) => {
          try {
            return { card, run: await onResolveCurrentRun(card), error: null }
          } catch {
            return {
              card,
              run: null,
              error: translate(
                'dashboard.collaboration.reconnectFailed',
                'Could not reconnect to this agent’s task run.'
              )
            }
          }
        })
      )
      if (active) {
        setRuns((previous) => {
          let next = previous
          for (const result of results) {
            const run = result.run
            if (run && !next.some((existing) => existing.runId === run.runId)) {
              next = [...next.filter((existing) => existing.paneKey !== run.paneKey), run]
            }
          }
          return next
        })
        setErrorsByPaneKey((previous) => {
          const next = { ...previous }
          for (const result of results) {
            if (result.error) {
              next[result.card.paneKey] = result.error
            } else if (result.run) {
              delete next[result.card.paneKey]
            }
          }
          return next
        })
      }
      resolving = false
    }
    void resolveRuns()
    const timer = window.setInterval(() => void resolveRuns(), 10_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [candidateKey, onResolveCurrentRun])

  useEffect(() => {
    if (runs.length === 0) {
      return
    }
    let active = true
    let polling = false
    const poll = async (): Promise<void> => {
      if (polling || document.visibilityState === 'hidden') {
        return
      }
      polling = true
      const results = await Promise.all(
        runs.map(async (run) => {
          try {
            const result = await callRuntimeRpc<{
              messages?: DashboardCollaborationMessage[]
            }>(run.target, 'orchestration.check', {
              terminal: run.terminalHandle,
              run: run.runId,
              all: true
            })
            return { paneKey: run.paneKey, messages: result.messages ?? [], error: null }
          } catch {
            return {
              paneKey: run.paneKey,
              messages: null,
              error: translate(
                'dashboard.collaboration.refreshFailed',
                'Collaboration updates could not be refreshed.'
              )
            }
          }
        })
      )
      if (active) {
        setUpdatesByPaneKey((previous) => {
          const next = { ...previous }
          for (const result of results) {
            if (result.messages) {
              next[result.paneKey] = result.messages
            }
          }
          return next
        })
        setErrorsByPaneKey((previous) => {
          const next = { ...previous }
          for (const result of results) {
            if (result.error) {
              next[result.paneKey] = result.error
            } else {
              delete next[result.paneKey]
            }
          }
          return next
        })
      }
      polling = false
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 3_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [runs])

  return { updatesByPaneKey, errorsByPaneKey, trackRun }
}
