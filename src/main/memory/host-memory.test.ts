import { beforeEach, describe, expect, it, vi } from 'vitest'
import os from 'node:os'

const { runProcessMock, readFileMock } = vi.hoisted(() => ({
  runProcessMock: vi.fn(),
  readFileMock: vi.fn()
}))

vi.mock('@orca/process-host', () => ({
  runProcess: runProcessMock
}))

vi.mock('node:fs/promises', () => ({
  readFile: (file: string, encoding: string) => readFileMock(file, encoding)
}))

async function loadHostMemory() {
  vi.resetModules()
  return import('./host-memory')
}

describe('host memory', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    runProcessMock.mockReset()
    readFileMock.mockReset()
    vi.spyOn(os, 'totalmem').mockReturnValue(1_000)
    vi.spyOn(os, 'freemem').mockReturnValue(100)
    vi.spyOn(os, 'cpus').mockReturnValue([{}, {}] as ReturnType<typeof os.cpus>)
    vi.spyOn(os, 'loadavg').mockReturnValue([1.5, 1, 0.5])
  })

  it('uses macOS memory-pressure availability instead of immediate free pages', async () => {
    vi.spyOn(os, 'platform').mockReturnValue('darwin')
    runProcessMock.mockResolvedValue({
      code: 0,
      signal: null,
      stdout: 'System-wide memory free percentage: 79%',
      stderr: '',
      timedOut: false
    })
    const { collectHostMemory } = await loadHostMemory()

    const host = await collectHostMemory()

    expect(host).toMatchObject({
      totalMemory: 1_000,
      freeMemory: 100,
      availableMemory: 790,
      availableMemorySource: 'memory-pressure',
      usedMemory: 210,
      memoryUsagePercent: 21,
      cpuCoreCount: 2,
      loadAverage1m: 1.5
    })
    expect(runProcessMock).toHaveBeenCalledWith({
      program: '/usr/bin/memory_pressure',
      args: ['-Q'],
      env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
      maxOutputBytes: 64 * 1024,
      timeoutMs: 1_000
    })
  })

  it('falls back once when macOS availability cannot be read', async () => {
    vi.spyOn(os, 'platform').mockReturnValue('darwin')
    runProcessMock.mockRejectedValue(new Error('unsupported'))
    const { collectHostMemory } = await loadHostMemory()

    const first = await collectHostMemory()
    const second = await collectHostMemory()

    expect(first).toMatchObject({
      availableMemory: 100,
      availableMemorySource: 'free-memory',
      usedMemory: 900,
      memoryUsagePercent: 90
    })
    expect(second.availableMemorySource).toBe('free-memory')
    expect(
      runProcessMock.mock.calls.filter(
        ([options]) => options?.program === '/usr/bin/memory_pressure'
      )
    ).toHaveLength(1)
  })

  it('uses Linux MemAvailable and keeps the value within physical RAM', async () => {
    vi.spyOn(os, 'platform').mockReturnValue('linux')
    vi.spyOn(os, 'totalmem').mockReturnValue(4 * 1024 * 1024)
    vi.spyOn(os, 'freemem').mockReturnValue(512 * 1024)
    readFileMock.mockResolvedValue('MemTotal: 4096 kB\nMemAvailable: 2048 kB\n')
    const { collectHostMemory } = await loadHostMemory()

    const host = await collectHostMemory()

    expect(host).toMatchObject({
      availableMemory: 2 * 1024 * 1024,
      availableMemorySource: 'proc-meminfo',
      usedMemory: 2 * 1024 * 1024,
      memoryUsagePercent: 50
    })
  })

  it('uses the bounded Node value on Windows', async () => {
    vi.spyOn(os, 'platform').mockReturnValue('win32')
    const { collectHostMemory } = await loadHostMemory()

    const host = await collectHostMemory()

    expect(host.availableMemory).toBe(100)
    expect(host.availableMemorySource).toBe('free-memory')
    expect(host.gpu).toEqual({
      utilizationPercent: null,
      memoryUsed: null,
      memoryTotal: null,
      source: 'unavailable'
    })
    expect(runProcessMock).toHaveBeenCalledWith(expect.objectContaining({ program: 'nvidia-smi' }))
    expect(readFileMock).not.toHaveBeenCalled()
  })

  it('calculates whole-host CPU utilization from successive OS samples', async () => {
    vi.spyOn(os, 'platform').mockReturnValue('linux')
    const cpuSamples: ReturnType<typeof os.cpus>[] = [
      [{ model: 'test', speed: 0, times: { user: 50, nice: 0, sys: 50, idle: 900, irq: 0 } }],
      [
        {
          model: 'test',
          speed: 0,
          times: { user: 100, nice: 0, sys: 100, idle: 1_000, irq: 0 }
        }
      ]
    ]
    vi.spyOn(os, 'cpus').mockImplementation(() => cpuSamples.shift() ?? [])
    runProcessMock.mockResolvedValue({
      code: 1,
      signal: null,
      stdout: '',
      stderr: '',
      timedOut: false
    })
    const { collectHostMemory } = await loadHostMemory()

    expect((await collectHostMemory()).cpuUsagePercent).toBeNull()
    expect((await collectHostMemory()).cpuUsagePercent).toBe(50)
  })

  it('exposes GPU utilization and memory only from parsed NVIDIA telemetry', async () => {
    const { parseNvidiaSmiMetrics } = await loadHostMemory()

    expect(parseNvidiaSmiMetrics('25, 1024, 8192\n75, 2048, 8192\n')).toEqual({
      utilizationPercent: 50,
      memoryUsed: 3 * 1024 * 1024 * 1024,
      memoryTotal: 16 * 1024 * 1024 * 1024,
      source: 'nvidia-smi'
    })
    expect(parseNvidiaSmiMetrics('N/A, N/A, N/A')).toBeNull()
  })

  it('uses the NVIDIA provider when it returns a valid host sample', async () => {
    vi.spyOn(os, 'platform').mockReturnValue('linux')
    runProcessMock.mockResolvedValue({
      code: 0,
      signal: null,
      stdout: '42, 1024, 4096\n',
      stderr: '',
      timedOut: false
    })
    const { collectHostMemory } = await loadHostMemory()

    const host = await collectHostMemory()

    expect(host.gpu).toEqual({
      utilizationPercent: 42,
      memoryUsed: 1024 * 1024 * 1024,
      memoryTotal: 4 * 1024 * 1024 * 1024,
      source: 'nvidia-smi'
    })
  })
})

describe('host availability parsers', () => {
  it('parses bounded macOS percentages', async () => {
    const { parseDarwinAvailableMemory } = await loadHostMemory()

    expect(parseDarwinAvailableMemory('System-wide memory free percentage: 42%', 1_000)).toBe(420)
    expect(parseDarwinAvailableMemory('System-wide memory free percentage: 101%', 1_000)).toBeNull()
  })

  it('parses Linux MemAvailable in KiB', async () => {
    const { parseLinuxAvailableMemory } = await loadHostMemory()

    expect(parseLinuxAvailableMemory('MemAvailable:    1234 kB\n')).toBe(1234 * 1024)
    expect(parseLinuxAvailableMemory('MemFree: 1234 kB\n')).toBeNull()
  })
})
