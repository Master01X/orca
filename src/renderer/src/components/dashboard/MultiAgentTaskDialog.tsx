import { useEffect, useMemo, useState } from 'react'
import { LoaderCircle, Play } from 'lucide-react'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { translate } from '@/i18n/i18n'
import type { DashboardCollaborationRun } from './multiagent-task'

export function MultiAgentTaskDialog({
  open,
  cards,
  onOpenChange,
  onCreateTask,
  onCreated
}: {
  open: boolean
  cards: DashboardCard[]
  onOpenChange: (open: boolean) => void
  onCreateTask: (args: {
    card: DashboardCard
    objective: string
  }) => Promise<DashboardCollaborationRun>
  onCreated: (run: DashboardCollaborationRun) => void
}): React.JSX.Element {
  const candidates = useMemo(
    () =>
      cards.filter(
        (card) =>
          card.bucket === 'working' &&
          card.parentPaneKey === undefined &&
          card.ptyId !== null &&
          card.leafId !== null
      ),
    [cards]
  )
  const [paneKey, setPaneKey] = useState('')
  const [objective, setObjective] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!candidates.some((card) => card.paneKey === paneKey)) {
      setPaneKey(candidates[0]?.paneKey ?? '')
    }
  }, [candidates, paneKey])

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const card = candidates.find((candidate) => candidate.paneKey === paneKey)
    if (!card || !objective.trim()) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      onCreated(await onCreateTask({ card, objective: objective.trim() }))
      setObjective('')
      onOpenChange(false)
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : translate('dashboard.multiAgentTask.startFailed', 'Task could not be started.')
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!busy) {
          onOpenChange(nextOpen)
        }
      }}
    >
      <DialogContent>
        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          <DialogHeader>
            <DialogTitle>
              {translate('dashboard.multiAgentTask.title', 'Start a multi-agent task')}
            </DialogTitle>
            <DialogDescription>
              {translate(
                'dashboard.multiAgentTask.description',
                'Choose the primary agent. Orca creates a tracked Run and asks it to delegate bounded subtasks to available agents.'
              )}
            </DialogDescription>
          </DialogHeader>
          {candidates.length === 0 ? (
            <p className="rounded-md border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
              {translate(
                'dashboard.multiAgentTask.noAgents',
                'No active agent with a live terminal is available. Start an agent first.'
              )}
            </p>
          ) : (
            <>
              <label className="block space-y-1.5 text-sm">
                <span>{translate('dashboard.multiAgentTask.primaryAgent', 'Primary agent')}</span>
                <select
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={paneKey}
                  onChange={(event) => setPaneKey(event.target.value)}
                  disabled={busy}
                >
                  {candidates.map((card) => (
                    <option key={card.paneKey} value={card.paneKey}>
                      {card.conversationName ?? card.worktreeName} ({card.agentType})
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1.5 text-sm">
                <span>{translate('dashboard.multiAgentTask.task', 'Task')}</span>
                <Textarea
                  value={objective}
                  onChange={(event) => setObjective(event.target.value)}
                  placeholder={translate(
                    'dashboard.multiAgentTask.objectivePlaceholder',
                    'Describe the outcome and any constraints'
                  )}
                  rows={5}
                  maxLength={20_000}
                  disabled={busy}
                  required
                />
              </label>
            </>
          )}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              {translate('common.cancel', 'Cancel')}
            </Button>
            <Button
              type="submit"
              disabled={busy || candidates.length === 0 || !objective.trim() || !paneKey}
            >
              {busy ? (
                <LoaderCircle className="mr-1.5 size-4 animate-spin" />
              ) : (
                <Play className="mr-1.5 size-3.5" />
              )}
              {busy
                ? translate('dashboard.multiAgentTask.starting', 'Starting…')
                : translate('dashboard.multiAgentTask.start', 'Start task')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
