import { describe, expect, it, vi } from 'vitest'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import { createMultiAgentTask, type MultiAgentRuntimeRpc } from './multiagent-task'

const target: RuntimeClientTarget = { kind: 'local' }
const card: Pick<DashboardCard, 'paneKey' | 'worktreeId'> = {
  paneKey: 'tab:leaf',
  worktreeId: 'worktree-a'
}

describe('createMultiAgentTask', () => {
  it('creates a durable run and task before guardedly prompting the selected primary', async () => {
    const calls: { method: string; params: unknown }[] = []
    const rpc: MultiAgentRuntimeRpc = async (
      _target: RuntimeClientTarget,
      method: string,
      params?: unknown
    ): Promise<unknown> => {
      calls.push({ method, params })
      const result =
        method === 'terminal.resolvePane'
          ? { terminal: 'term-primary' }
          : method === 'orchestration.runCurrent'
            ? { run: null }
            : method === 'orchestration.runCreate'
              ? { run: { id: 'run-1' } }
              : method === 'orchestration.taskCreate'
                ? { task: { id: 'task-1' } }
                : { send: { accepted: true } }
      return result
    }

    const result = await createMultiAgentTask({
      card,
      objective: 'Implement the feature',
      target,
      callRuntimeRpc: rpc
    })

    expect(result).toMatchObject({
      paneKey: card.paneKey,
      runId: 'run-1',
      terminalHandle: 'term-primary'
    })
    expect(calls.map((call) => call.method)).toEqual([
      'terminal.resolvePane',
      'orchestration.runCurrent',
      'orchestration.runCreate',
      'orchestration.taskCreate',
      'terminal.send'
    ])
    expect(calls.at(-1)?.params).toMatchObject({
      terminal: 'term-primary',
      agentPrompt: true,
      requireAgentStatus: 'sendable',
      text: expect.stringContaining('delegate suitable subtasks')
    })
  })

  it('does not replace a primary that already owns a run', async () => {
    const request = vi.fn(
      async (_target: RuntimeClientTarget, method: string, _params?: unknown): Promise<unknown> => {
        const result =
          method === 'terminal.resolvePane'
            ? { terminal: 'term-primary' }
            : { run: { id: 'existing-run' } }
        return result
      }
    )
    const rpc: MultiAgentRuntimeRpc = async (
      _target: RuntimeClientTarget,
      method: string,
      params?: unknown
    ): Promise<unknown> => request(_target, method, params)
    await expect(
      createMultiAgentTask({
        card,
        objective: 'Implement the feature',
        target,
        callRuntimeRpc: rpc
      })
    ).rejects.toThrow(/already coordinates/)
    expect(request).toHaveBeenCalledTimes(2)
  })
})
