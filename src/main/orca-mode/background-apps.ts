import { BrowserWindow, dialog, type WebContents } from 'electron'
import { runProcess } from '@orca/process-host'
import { windowsPowerShellPath } from '@orca/process-host/windows-system-binary'

export type BackgroundApplicationCandidate = {
  pid: number
  name: string
  title: string
  sessionId: number
}

const QUERY_TIMEOUT_MS = 5_000
const QUERY_MAX_OUTPUT_BYTES = 2 * 1024 * 1024
const PROTECTED_PROCESS_NAMES = new Set([
  'csrss',
  'dwm',
  'explorer',
  'lsass',
  'registry',
  'services',
  'smss',
  'system',
  'wininit',
  'winlogon'
])

const PROCESS_QUERY = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $sessionId = (Get-Process -Id $PID).SessionId; Get-Process | Where-Object { $_.SessionId -eq $sessionId -and $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -and $_.Id -ne ${process.pid} -and $_.ProcessName -notmatch '^orca(?:\\.exe)?$' } | Select-Object @{Name="pid";Expression={$_.Id}},@{Name="name";Expression={$_.ProcessName}},@{Name="title";Expression={$_.MainWindowTitle}},@{Name="sessionId";Expression={$_.SessionId}} | ConvertTo-Json -Compress`

export function parseBackgroundApplicationCandidates(
  stdout: string
): BackgroundApplicationCandidate[] | null {
  const contents = stdout.trim()
  if (!contents) {
    return []
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(contents)
  } catch {
    return null
  }
  const rows = Array.isArray(parsed) ? parsed : [parsed]
  const candidates = new Map<number, BackgroundApplicationCandidate>()
  for (const value of rows) {
    if (!isRecord(value)) {
      continue
    }
    const pid = typeof value.pid === 'number' ? value.pid : Number(value.pid)
    const name = typeof value.name === 'string' ? value.name.trim() : ''
    const title = typeof value.title === 'string' ? value.title.trim() : ''
    const sessionId =
      typeof value.sessionId === 'number' ? value.sessionId : Number(value.sessionId)
    if (
      !Number.isSafeInteger(pid) ||
      pid <= 0 ||
      !Number.isSafeInteger(sessionId) ||
      sessionId < 0 ||
      !name ||
      !title ||
      PROTECTED_PROCESS_NAMES.has(name.toLowerCase())
    ) {
      continue
    }
    candidates.set(pid, { pid, name, title, sessionId })
  }
  return [...candidates.values()].sort((left, right) => left.name.localeCompare(right.name))
}

export async function reviewBackgroundApplications(
  owner?: BrowserWindow,
  platform: NodeJS.Platform = process.platform
): Promise<void> {
  if (platform !== 'win32') {
    return
  }
  const listed = await runProcess({
    program: windowsPowerShellPath(),
    args: ['-NoProfile', '-NonInteractive', '-Command', PROCESS_QUERY],
    timeoutMs: QUERY_TIMEOUT_MS,
    maxOutputBytes: QUERY_MAX_OUTPUT_BYTES
  })
  if (listed.timedOut || listed.code !== 0) {
    throw new Error('Could not inspect open application windows.')
  }
  const candidates = parseBackgroundApplicationCandidates(listed.stdout)
  if (!candidates) {
    throw new Error('The open application list could not be parsed.')
  }
  if (candidates.length === 0) {
    return
  }
  const preview = candidates
    .slice(0, 8)
    .map((candidate) => `${candidate.name} — ${candidate.title}`)
    .join('\n')
  const remainingCount = candidates.length - Math.min(candidates.length, 8)
  const answer = await (owner
    ? dialog.showMessageBox(owner, {
        type: 'warning',
        buttons: ['Force close apps', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        title: 'Orca Mode: close external apps',
        message: `Force close ${candidates.length} open app${candidates.length === 1 ? '' : 's'}?`,
        detail: `${preview}${remainingCount > 0 ? `\n…and ${remainingCount} more` : ''}\n\nForce closing discards unsaved work in affected apps. Orca itself and protected Windows system processes are excluded.`
      })
    : dialog.showMessageBox({
        type: 'warning',
        buttons: ['Force close apps', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        title: 'Orca Mode: close external apps',
        message: `Force close ${candidates.length} open app${candidates.length === 1 ? '' : 's'}?`,
        detail: `${preview}${remainingCount > 0 ? `\n…and ${remainingCount} more` : ''}\n\nForce closing discards unsaved work in affected apps. Orca itself and protected Windows system processes are excluded.`
      }))
  if (answer.response !== 0) {
    return
  }

  const targets = Buffer.from(JSON.stringify(candidates), 'utf8').toString('base64')
  const script =
    `$targets = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${targets}')) | ConvertFrom-Json; ` +
    '$sessionId = (Get-Process -Id $PID).SessionId; $terminated = 0; $failed = 0; ' +
    'foreach ($target in $targets) { try { $app = Get-Process -Id ([int]$target.pid) -ErrorAction Stop; ' +
    'if ($app.ProcessName -ne [string]$target.name -or $app.SessionId -ne [int]$target.sessionId -or ' +
    '$app.SessionId -ne $sessionId -or $app.MainWindowHandle -eq 0) { continue }; ' +
    'Stop-Process -Id $app.Id -Force -ErrorAction Stop; $terminated++ } catch { $failed++ } }; ' +
    '[pscustomobject]@{terminated=$terminated;failed=$failed} | ConvertTo-Json -Compress'
  const result = await runProcess({
    program: windowsPowerShellPath(),
    args: ['-NoProfile', '-NonInteractive', '-Command', script],
    timeoutMs: QUERY_TIMEOUT_MS,
    maxOutputBytes: 16 * 1024
  })
  if (result.timedOut || result.code !== 0) {
    throw new Error('Force-closing external applications did not complete.')
  }
  let summary: unknown
  try {
    summary = JSON.parse(result.stdout)
  } catch {
    throw new Error(
      'The app close operation returned an invalid result; some apps may have closed.'
    )
  }
  if (!isCloseSummary(summary)) {
    throw new Error(
      'The app close operation returned an invalid result; some apps may have closed.'
    )
  }
  const { terminated, failed } = summary
  if (failed > 0) {
    throw new Error(`Force-closed ${terminated} app(s); ${failed} app(s) could not be closed.`)
  }
}

function isCloseSummary(value: unknown): value is { terminated: number; failed: number } {
  if (!isRecord(value)) {
    return false
  }
  return typeof value.terminated === 'number' && typeof value.failed === 'number'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function startBackgroundAppReviewOnEnable(
  previouslyEnabled: boolean | undefined,
  enabled: boolean | undefined,
  sender: WebContents
): void {
  if (previouslyEnabled === true || enabled !== true) {
    return
  }
  const owner = BrowserWindow.fromWebContents(sender) ?? undefined
  void reviewBackgroundApplications(owner).catch((error: unknown) => {
    console.warn('[orca-mode] background-app review failed:', error)
    const notice = {
      type: 'warning' as const,
      buttons: ['OK'],
      title: 'Orca Mode',
      message: 'Orca could not complete external app cleanup.',
      detail:
        error instanceof Error
          ? error.message
          : 'The process scan or close operation failed; some apps may have closed.'
    }
    if (owner) {
      void dialog.showMessageBox(owner, notice).catch(() => undefined)
    } else {
      void dialog.showMessageBox(notice).catch(() => undefined)
    }
  })
}
