import { afterEach, describe, expect, it, vi } from 'vitest'

const { runProcessMock, showMessageBoxMock } = vi.hoisted(() => ({
  runProcessMock: vi.fn(),
  showMessageBoxMock: vi.fn()
}))

vi.mock('@orca/process-host', () => ({ runProcess: runProcessMock }))
vi.mock('@orca/process-host/windows-system-binary', () => ({
  windowsPowerShellPath: () => 'powershell.exe'
}))
vi.mock('electron', () => ({
  dialog: { showMessageBox: showMessageBoxMock }
}))

import {
  parseBackgroundApplicationCandidates,
  reviewBackgroundApplications
} from './background-apps'

afterEach(() => {
  vi.clearAllMocks()
})

describe('parseBackgroundApplicationCandidates', () => {
  it('accepts windowed user apps and omits malformed and protected system processes', () => {
    expect(
      parseBackgroundApplicationCandidates(
        JSON.stringify([
          { pid: 12, name: 'editor', title: 'Untitled', sessionId: 1 },
          { pid: 13, name: 'explorer', title: 'Desktop', sessionId: 1 },
          { pid: 14, name: 'headless', title: '', sessionId: 1 },
          { pid: 'invalid', name: 'browser', title: 'Home', sessionId: 1 },
          { pid: 15, name: 'browser', title: 'Other session', sessionId: -1 }
        ])
      )
    ).toEqual([{ pid: 12, name: 'editor', title: 'Untitled', sessionId: 1 }])
    expect(parseBackgroundApplicationCandidates('{')).toBeNull()
  })
})

describe('reviewBackgroundApplications', () => {
  it('requires explicit consent before force-closing windowed apps in the current session', async () => {
    runProcessMock
      .mockResolvedValueOnce({
        code: 0,
        timedOut: false,
        stdout: '[{"pid":42,"name":"editor","title":"Draft","sessionId":1}]'
      })
      .mockResolvedValueOnce({
        code: 0,
        timedOut: false,
        stdout: '{"terminated":1,"failed":0}'
      })
    showMessageBoxMock.mockResolvedValue({ response: 0 })

    await reviewBackgroundApplications(undefined, 'win32')

    expect(showMessageBoxMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Force close 1 open app?',
        buttons: ['Force close apps', 'Cancel'],
        detail: expect.stringContaining('discards unsaved work')
      })
    )
    expect(runProcessMock).toHaveBeenCalledTimes(2)
    const closeScript = runProcessMock.mock.calls[1]?.[0]?.args[3]
    expect(typeof closeScript).toBe('string')
    if (typeof closeScript !== 'string') {
      throw new Error('Expected the app close PowerShell command.')
    }
    const encodedTargets = closeScript.match(/FromBase64String\('([^']+)'\)/)?.[1]
    expect(encodedTargets).toBeDefined()
    if (!encodedTargets) {
      throw new Error('Expected encoded targets in the app close command.')
    }
    const targets = JSON.parse(Buffer.from(encodedTargets, 'base64').toString('utf8'))
    expect(targets).toEqual([{ pid: 42, name: 'editor', title: 'Draft', sessionId: 1 }])
    expect(closeScript).toContain('Stop-Process -Id $app.Id -Force')
    expect(closeScript).toContain('$app.SessionId -ne $sessionId')
  })

  it('does not close any applications when the user declines permission', async () => {
    runProcessMock.mockResolvedValueOnce({
      code: 0,
      timedOut: false,
      stdout: '[{"pid":42,"name":"editor","title":"Draft","sessionId":1}]'
    })
    showMessageBoxMock.mockResolvedValue({ response: 1 })

    await reviewBackgroundApplications(undefined, 'win32')

    expect(showMessageBoxMock).toHaveBeenCalledOnce()
    expect(runProcessMock).toHaveBeenCalledOnce()
  })

  it('does not enumerate processes on unsupported platforms', async () => {
    await reviewBackgroundApplications(undefined, 'darwin')
    expect(runProcessMock).not.toHaveBeenCalled()
  })

  it('surfaces a failed process scan rather than treating it as an empty list', async () => {
    runProcessMock.mockResolvedValue({ code: 1, timedOut: false, stdout: '' })

    await expect(reviewBackgroundApplications(undefined, 'win32')).rejects.toThrow(
      'Could not inspect open application windows.'
    )
  })
})
