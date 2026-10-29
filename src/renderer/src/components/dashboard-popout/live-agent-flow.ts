import {
  DASHBOARD_BUCKET_ORDER,
  type DashboardBucket,
  type DashboardCard
} from '../../../../shared/dashboard-snapshot'

export type LiveAgentWorkflow = {
  id: string
  repoName: string
  worktreeName: string
  cards: DashboardCard[]
}

export type LiveAgentMetrics = {
  activeAgents: number
  needsAttention: number
  activeWorkspaces: number
}

export type LiveAgentLane = {
  bucket: DashboardBucket
  cards: DashboardCard[]
}

export function buildLiveAgentWorkflows(cards: DashboardCard[]): LiveAgentWorkflow[] {
  const workflows = new Map<string, LiveAgentWorkflow>()
  for (const card of cards) {
    let workflow = workflows.get(card.worktreeId)
    if (!workflow) {
      workflow = {
        id: card.worktreeId,
        repoName: card.repoName,
        worktreeName: card.worktreeName,
        cards: []
      }
      workflows.set(card.worktreeId, workflow)
    }
    workflow.cards.push(card)
  }
  return [...workflows.values()]
}

export function buildLiveAgentLanes(cards: DashboardCard[]): LiveAgentLane[] {
  return DASHBOARD_BUCKET_ORDER.map((bucket) => ({
    bucket,
    cards: cards.filter((card) => card.bucket === bucket)
  }))
}

export function buildLiveAgentMetrics(cards: DashboardCard[]): LiveAgentMetrics {
  const activeCards = cards.filter(
    (card) => card.bucket === 'working' || card.bucket === 'attention'
  )
  return {
    activeAgents: activeCards.length,
    needsAttention: cards.filter((card) => card.bucket === 'attention').length,
    activeWorkspaces: new Set(activeCards.map((card) => card.worktreeId)).size
  }
}
