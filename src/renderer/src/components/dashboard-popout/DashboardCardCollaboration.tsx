import { AgentStateDot } from '@/components/AgentStateDot'
import type { DashboardCollaborationMessage } from '../dashboard/multiagent-task'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import { translate } from '@/i18n/i18n'

export function DashboardCardCollaboration({
  subagents,
  updates,
  error
}: {
  subagents: DashboardCard['subagents']
  updates: DashboardCollaborationMessage[]
  error?: string
}): React.JSX.Element {
  return (
    <section className="space-y-1.5 border-t border-border/50 pt-1.5">
      <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
        <span>{translate('dashboardPopout.card.collaboration', 'Collaboration')}</span>
        {updates.length > 0 ? <span className="tabular-nums">({updates.length})</span> : null}
      </div>
      {error ? (
        <p role="status" className="text-[10px] text-destructive">
          {error}
        </p>
      ) : null}
      {subagents?.length ? (
        <div className="ml-1 flex flex-col gap-1 border-l border-border pl-2">
          {subagents.map((subagent) => (
            <div
              key={subagent.id}
              className="flex items-center gap-1.5 py-0.5 text-[11px] text-muted-foreground"
            >
              <AgentStateDot state={subagent.dotState} />
              <span className="truncate">{subagent.name}</span>
            </div>
          ))}
        </div>
      ) : null}
      {updates.length > 0 ? (
        <details className="group/updates">
          <summary className="cursor-pointer text-[10px] text-muted-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {translate('dashboardPopout.card.recentAgentMessages', 'Show recent agent messages')}
          </summary>
          <div className="scrollbar-sleek mt-1 flex max-h-48 flex-col gap-1.5 overflow-y-auto">
            {updates.toReversed().map((message) => (
              <div key={message.id} className="border-l border-border pl-2 text-[10px]">
                <div className="truncate font-medium text-foreground/75">
                  {message.from_handle}: {message.subject}
                </div>
                <p className="whitespace-pre-wrap break-words text-muted-foreground">
                  {message.body}
                </p>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  )
}
