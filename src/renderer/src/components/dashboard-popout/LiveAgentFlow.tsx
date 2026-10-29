import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CircleDot,
  GitBranch,
  MessageSquareText
} from 'lucide-react'
import { AgentTypeIcon } from '@/lib/agent-type-icon'
import { formatAgentTypeLabel } from '@/lib/agent-status'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { DashboardBucket, DashboardCard } from '../../../../shared/dashboard-snapshot'
import {
  buildLiveAgentLanes,
  buildLiveAgentMetrics,
  buildLiveAgentWorkflows
} from './live-agent-flow'

function bucketLabel(bucket: DashboardBucket): string {
  switch (bucket) {
    case 'attention':
      return translate('dashboardLiveFlow.state.attention', 'Needs attention')
    case 'working':
      return translate('dashboardLiveFlow.state.working', 'Working')
    case 'done':
      return translate('dashboardLiveFlow.state.done', 'Done')
    case 'idle':
      return translate('dashboardLiveFlow.state.idle', 'Idle')
  }
}

function stateLabel(card: DashboardCard): string {
  return card.bucket === 'working' && card.workingMode === 'monitoring'
    ? translate('dashboardLiveFlow.state.monitoring', 'Monitoring')
    : bucketLabel(card.bucket)
}

function stateClass(card: DashboardCard): string {
  switch (card.bucket) {
    case 'attention':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
    case 'working':
      return 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300'
    case 'done':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    case 'idle':
      return 'border-border bg-muted/50 text-muted-foreground'
  }
}

function elapsedLabel(card: DashboardCard, now: number): string {
  const start = card.startedAt
  const end = card.finishedAt ?? now
  if (start <= 0 || end < start) {
    return translate('dashboardLiveFlow.duration.unknown', 'Duration unavailable')
  }
  const seconds = Math.floor((end - start) / 1000)
  const minutes = Math.floor(seconds / 60)
  if (minutes < 1) {
    return translate('dashboardLiveFlow.duration.seconds', '{{count}}s active', { count: seconds })
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 1) {
    return translate('dashboardLiveFlow.duration.minutes', '{{count}}m active', { count: minutes })
  }
  return translate('dashboardLiveFlow.duration.hours', '{{hours}}h {{minutes}}m active', {
    hours,
    minutes: minutes % 60
  })
}

function MessageLine({
  kind,
  message
}: {
  kind: 'prompt' | 'response'
  message: string | undefined
}): React.JSX.Element | null {
  const content = message?.trim()
  if (!content) {
    return null
  }
  const isPrompt = kind === 'prompt'
  const Icon = isPrompt ? ArrowUpRight : ArrowDownRight
  return (
    <div className="flex min-w-0 items-start gap-1.5 text-2xs">
      <Icon className="mt-0.5 size-3 shrink-0 text-muted-foreground" aria-hidden />
      <span className="shrink-0 font-medium text-muted-foreground">
        {isPrompt
          ? translate('dashboardLiveFlow.message.prompt', 'Prompt')
          : translate('dashboardLiveFlow.message.response', 'Response')}
      </span>
      <span className="min-w-0 truncate text-foreground/80" title={content}>
        {content}
      </span>
    </div>
  )
}

function AgentNode({
  card,
  now,
  onOpen
}: {
  card: DashboardCard
  now: number
  onOpen: (card: DashboardCard) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onOpen(card)}
      className="min-w-0 rounded-lg border border-border/70 bg-background p-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      aria-label={`${formatAgentTypeLabel(card.agentType)}: ${card.conversationName || card.task || card.worktreeName}, ${stateLabel(card)}`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <AgentTypeIcon agentType={card.agentType} size={15} />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {card.conversationName || card.task || card.worktreeName}
        </span>
        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-3xs',
            stateClass(card)
          )}
        >
          <CircleDot className="size-2.5" aria-hidden />
          {stateLabel(card)}
        </span>
      </span>
      <span className="mt-1 block pl-[23px] text-3xs text-muted-foreground">
        {formatAgentTypeLabel(card.agentType)} · {elapsedLabel(card, now)}
      </span>
      {card.lastUserMessage || card.lastAgentMessage ? (
        <div className="mt-2 space-y-1 border-t border-border/60 pt-2">
          <MessageLine kind="prompt" message={card.lastUserMessage} />
          <MessageLine kind="response" message={card.lastAgentMessage} />
        </div>
      ) : null}
    </button>
  )
}

export function LiveAgentFlow({
  cards,
  now,
  onOpen
}: {
  cards: DashboardCard[]
  now: number
  onOpen: (card: DashboardCard) => void
}): React.JSX.Element {
  const metrics = buildLiveAgentMetrics(cards)
  const workflows = buildLiveAgentWorkflows(cards)
  const agentName = (card: DashboardCard): string =>
    card.conversationName || card.task || formatAgentTypeLabel(card.agentType)

  return (
    <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto p-3">
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-3">
        <section
          aria-label={translate('dashboardLiveFlow.metrics.label', 'Live agent metrics')}
          className="grid grid-cols-1 gap-2 sm:grid-cols-3"
        >
          {[
            {
              label: translate('dashboardLiveFlow.metrics.active', 'Active agents'),
              value: metrics.activeAgents
            },
            {
              label: translate('dashboardLiveFlow.metrics.attention', 'Needs attention'),
              value: metrics.needsAttention
            },
            {
              label: translate('dashboardLiveFlow.metrics.workspaces', 'Active workspaces'),
              value: metrics.activeWorkspaces
            }
          ].map((metric) => (
            <div
              key={metric.label}
              className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2"
            >
              <div className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
                {metric.label}
              </div>
              <div className="mt-0.5 text-lg font-semibold tabular-nums">{metric.value}</div>
            </div>
          ))}
        </section>

        {workflows.length === 0 ? (
          <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border text-center">
            <MessageSquareText className="size-5 text-muted-foreground" aria-hidden />
            <p className="text-xs text-muted-foreground">
              {translate('dashboardLiveFlow.empty', 'No live agents or messages to visualize')}
            </p>
          </div>
        ) : (
          workflows.map((workflow) => (
            <section
              key={workflow.id}
              aria-label={`${workflow.repoName} / ${workflow.worktreeName}`}
              className="rounded-xl border border-border/70 bg-card p-3"
            >
              <header className="mb-3 flex items-center gap-2">
                <GitBranch className="size-3.5 text-muted-foreground" aria-hidden />
                <h2 className="min-w-0 flex-1 truncate text-xs font-semibold">
                  {workflow.repoName} / {workflow.worktreeName}
                </h2>
                <span className="text-3xs tabular-nums text-muted-foreground">
                  {translate('dashboardLiveFlow.workflow.agentCount', '{{count}} agents', {
                    count: workflow.cards.length
                  })}
                </span>
              </header>
              <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2 2xl:grid-cols-4">
                {buildLiveAgentLanes(workflow.cards).map((lane) => (
                  <section
                    key={lane.bucket}
                    aria-label={bucketLabel(lane.bucket)}
                    className="min-w-0"
                  >
                    <header className="flex items-center gap-2 border-b border-border/60 px-1 py-2">
                      <span
                        className={cn(
                          'size-2 shrink-0 rounded-full',
                          lane.bucket === 'attention'
                            ? 'bg-agent-question'
                            : lane.bucket === 'working'
                              ? 'bg-agent-working'
                              : lane.bucket === 'done'
                                ? 'bg-emerald-500'
                                : 'bg-muted-foreground/40'
                        )}
                        aria-hidden
                      />
                      <h3 className="min-w-0 flex-1 truncate text-2xs font-medium text-muted-foreground">
                        {bucketLabel(lane.bucket)}
                      </h3>
                      <span className="text-3xs tabular-nums text-muted-foreground">
                        {lane.cards.length}
                      </span>
                    </header>
                    <div className="flex min-h-14 flex-col">
                      {lane.cards.length === 0 ? (
                        <p className="px-2 py-3 text-3xs text-muted-foreground">
                          {translate('dashboardPopout.bucket.empty', 'None')}
                        </p>
                      ) : (
                        lane.cards.map((card) => (
                          <AgentNode key={card.paneKey} card={card} now={now} onOpen={onOpen} />
                        ))
                      )}
                    </div>
                  </section>
                ))}
              </div>
              {workflow.cards.some((card) =>
                workflow.cards.some((parent) => parent.paneKey === card.parentPaneKey)
              ) ? (
                <div
                  aria-label={translate('dashboardLiveFlow.delegations', 'Known delegation paths')}
                  className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-2"
                >
                  {workflow.cards
                    .filter((card) =>
                      workflow.cards.some((parent) => parent.paneKey === card.parentPaneKey)
                    )
                    .map((card) => {
                      const parent = workflow.cards.find(
                        (candidate) => candidate.paneKey === card.parentPaneKey
                      )
                      if (!parent) {
                        return null
                      }
                      return (
                        <span
                          key={card.paneKey}
                          className="inline-flex min-w-0 items-center gap-1.5 rounded-md border border-border/60 bg-background px-2 py-1 text-3xs"
                        >
                          <GitBranch
                            className="size-3 shrink-0 text-muted-foreground"
                            aria-hidden
                          />
                          <span className="max-w-40 truncate" title={agentName(parent)}>
                            {agentName(parent)}
                          </span>
                          <ArrowRight
                            className="size-3 shrink-0 text-muted-foreground"
                            aria-hidden
                          />
                          <span className="max-w-40 truncate" title={agentName(card)}>
                            {agentName(card)}
                          </span>
                        </span>
                      )
                    })}
                </div>
              ) : null}
            </section>
          ))
        )}
        <p className="text-3xs text-muted-foreground">
          {translate(
            'dashboardLiveFlow.messageScope',
            'Prompts and responses show each agent’s latest observed messages. Arrows show known parent/child delegation links, not message delivery.'
          )}
        </p>
      </div>
    </div>
  )
}
