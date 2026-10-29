import { describe, expect, it } from 'vitest'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import {
  buildLiveAgentLanes,
  buildLiveAgentMetrics,
  buildLiveAgentWorkflows
} from './live-agent-flow'

function card(overrides: Partial<DashboardCard>): DashboardCard {
  return {
    paneKey: 'pane-1',
    ptyId: null,
    agentType: 'claude',
    bucket: 'working',
    dotState: 'working',
    task: '',
    repoId: 'repo-1',
    worktreeId: 'worktree-1',
    tabId: 'tab-1',
    leafId: null,
    repoName: 'Repository',
    worktreeName: 'Workspace',
    startedAt: 1,
    finishedAt: null,
    stateChangedAt: 1,
    unseen: false,
    ...overrides
  }
}

describe('live agent flow projection', () => {
  it('groups agents by their workspace while retaining all card data', () => {
    const first = card({ paneKey: 'parent' })
    const child = card({ paneKey: 'child', parentPaneKey: 'parent' })
    const other = card({ paneKey: 'other', worktreeId: 'worktree-2', worktreeName: 'Second' })

    expect(buildLiveAgentWorkflows([first, child, other])).toEqual([
      {
        id: 'worktree-1',
        repoName: 'Repository',
        worktreeName: 'Workspace',
        cards: [first, child]
      },
      {
        id: 'worktree-2',
        repoName: 'Repository',
        worktreeName: 'Second',
        cards: [other]
      }
    ])
  })

  it('counts active agents, attention states, and workspaces without counting completed work', () => {
    const cards = [
      card({ paneKey: 'working' }),
      card({ paneKey: 'blocked', bucket: 'attention', dotState: 'blocked' }),
      card({ paneKey: 'idle', bucket: 'idle', dotState: 'idle', worktreeId: 'worktree-2' }),
      card({ paneKey: 'done', bucket: 'done', dotState: 'done', worktreeId: 'worktree-3' })
    ]

    expect(buildLiveAgentMetrics(cards)).toEqual({
      activeAgents: 2,
      needsAttention: 1,
      activeWorkspaces: 1
    })
  })

  it('places each live agent in exactly one lifecycle lane, including empty lanes', () => {
    const working = card({ paneKey: 'working' })
    const attention = card({ paneKey: 'attention', bucket: 'attention', dotState: 'blocked' })
    const done = card({ paneKey: 'done', bucket: 'done', dotState: 'done' })

    expect(buildLiveAgentLanes([working, attention, done])).toEqual([
      { bucket: 'attention', cards: [attention] },
      { bucket: 'working', cards: [working] },
      { bucket: 'done', cards: [done] },
      { bucket: 'idle', cards: [] }
    ])
  })
})
