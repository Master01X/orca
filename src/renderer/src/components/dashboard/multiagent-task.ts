import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import { callRuntimeRpc as defaultCallRuntimeRpc } from '@/runtime/runtime-rpc-client'

export type MultiAgentRuntimeRpc = (
  target: RuntimeClientTarget,
  method: string,
  params?: unknown
) => Promise<unknown>

export type DashboardCollaborationRun = {
  paneKey: string
  runId: string
  terminalHandle: string
  target: RuntimeClientTarget
}

const DESKTOP_CLIENT = { id: 'orca-dashboard', type: 'desktop' as const }

export async function createMultiAgentTask(args: {
  card: Pick<DashboardCard, 'paneKey' | 'worktreeId'>
  objective: string
  target: RuntimeClientTarget
  callRuntimeRpc?: MultiAgentRuntimeRpc
}): Promise<DashboardCollaborationRun> {
  const { card, objective, target } = args
  const call = args.callRuntimeRpc ?? defaultCallRuntimeRpc
  const terminalResponse = await call(target, 'terminal.resolvePane', {
    paneKey: card.paneKey,
    worktreeId: card.worktreeId
  })
  if (
    !isRecord(terminalResponse) ||
    typeof terminalResponse.terminal !== 'string' ||
    terminalResponse.terminal.length === 0
  ) {
    throw new Error('The selected primary agent terminal could not be resolved.')
  }
  const terminal = terminalResponse.terminal
  const currentRunResponse = await call(target, 'orchestration.runCurrent', { from: terminal })
  if (!isRecord(currentRunResponse) || !('run' in currentRunResponse)) {
    throw new Error('The selected primary agent task status could not be read.')
  }
  const currentRun = currentRunResponse.run
  if (currentRun !== null && (!isRecord(currentRun) || typeof currentRun.id !== 'string')) {
    throw new Error('The selected primary agent task status was invalid.')
  }
  if (currentRun) {
    throw new Error(
      'This agent already coordinates an orchestration run. Choose another primary agent.'
    )
  }

  const runResponse = await call(target, 'orchestration.runCreate', {
    objective,
    from: terminal
  })
  if (
    !isRecord(runResponse) ||
    !isRecord(runResponse.run) ||
    typeof runResponse.run.id !== 'string' ||
    runResponse.run.id.length === 0
  ) {
    throw new Error('The selected primary agent task run could not be created.')
  }
  const runId = runResponse.run.id
  const taskResponse = await call(target, 'orchestration.taskCreate', {
    spec: objective,
    taskTitle: objective.slice(0, 120),
    displayName: 'Primary task',
    callerTerminalHandle: terminal,
    run: runId
  })
  if (
    !isRecord(taskResponse) ||
    !isRecord(taskResponse.task) ||
    typeof taskResponse.task.id !== 'string' ||
    taskResponse.task.id.length === 0
  ) {
    throw new Error('The selected primary agent task could not be created.')
  }
  const taskId = taskResponse.task.id

  const prompt = [
    `Own and complete this Orca task: ${objective}`,
    `Orchestration Run: ${runId}`,
    `Primary Task: ${taskId}`,
    'Keep ownership of the primary task. Break it into bounded subtasks, create them in this Run, and delegate suitable subtasks to available agents using orchestration worker-start.',
    'Review each worker result before completion. Send concise progress and worker reports to the Run coordinator inbox with orchestration send, update subtask statuses, then mark the primary task completed, failed, or blocked with its final result.'
  ].join('\n\n')
  const sendResponse = await call(target, 'terminal.send', {
    terminal,
    text: prompt,
    enter: true,
    agentPrompt: true,
    requireAgentStatus: 'sendable',
    client: DESKTOP_CLIENT
  })
  if (
    !isRecord(sendResponse) ||
    !isRecord(sendResponse.send) ||
    typeof sendResponse.send.accepted !== 'boolean'
  ) {
    throw new Error('The selected primary agent returned an invalid send result.')
  }
  const send = sendResponse.send
  if (!send.accepted) {
    const reason =
      typeof send.refusedReason === 'string'
        ? send.refusedReason
        : 'The selected agent could not accept the task prompt.'
    await call(target, 'orchestration.taskUpdate', {
      id: taskId,
      status: 'failed',
      result: reason,
      run: runId,
      callerTerminalHandle: terminal
    })
    throw new Error(reason)
  }

  return { paneKey: card.paneKey, runId, terminalHandle: terminal, target }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export type DashboardCollaborationMessage = {
  id: string
  from_handle: string
  subject: string
  body: string
  type: string
  created_at: string
}
