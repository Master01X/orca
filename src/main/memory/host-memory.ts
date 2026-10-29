import { runProcess } from '@orca/process-host'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type {
  HostAvailableMemorySource,
  HostGpuMetrics,
  HostMemory
} from '../../shared/process-stats-types'

const MEMORY_PRESSURE_TIMEOUT_MS = 1_000
const MEMORY_PRESSURE_MAX_BUFFER = 64 * 1024
const GPU_QUERY_TIMEOUT_MS = 1_000
const GPU_QUERY_MAX_BUFFER = 64 * 1024
const KIB = 1024

let darwinAvailabilitySupported = true
let linuxAvailabilitySupported = true
let previousCpuSample: { total: number[]; idle: number[] } | null = null

export async function collectHostMemory(): Promise<HostMemory> {
  const cpus = os.cpus()
  const cpuUsagePercent = readCpuUsagePercent(cpus)
  const total = nonNegativeNumber(os.totalmem())
  const free = Math.min(total, nonNegativeNumber(os.freemem()))
  const platform = os.platform()
  const [preferred, gpu] = await Promise.all([
    readAvailableMemory(platform, total),
    readGpuMetrics(platform)
  ])
  const available = Math.min(total, Math.max(free, preferred?.bytes ?? free))
  const used = Math.max(0, total - available)

  return {
    totalMemory: total,
    freeMemory: free,
    availableMemory: available,
    availableMemorySource: preferred?.source ?? 'free-memory',
    usedMemory: used,
    memoryUsagePercent: total > 0 ? (used / total) * 100 : 0,
    cpuUsagePercent,
    gpu,
    cpuCoreCount: Math.max(1, cpus.length),
    loadAverage1m: nonNegativeNumber(os.loadavg()[0])
  }
}

export function fallbackHostMemory(): HostMemory {
  const total = nonNegativeNumber(os.totalmem())
  const free = Math.min(total, nonNegativeNumber(os.freemem()))
  const used = Math.max(0, total - free)
  return {
    totalMemory: total,
    freeMemory: free,
    availableMemory: free,
    availableMemorySource: 'free-memory',
    usedMemory: used,
    memoryUsagePercent: total > 0 ? (used / total) * 100 : 0,
    cpuUsagePercent: null,
    gpu: unavailableGpuMetrics(),
    cpuCoreCount: Math.max(1, os.cpus().length),
    loadAverage1m: nonNegativeNumber(os.loadavg()[0])
  }
}

function readCpuUsagePercent(cpus: ReturnType<typeof os.cpus>): number | null {
  if (cpus.length === 0) {
    previousCpuSample = null
    return null
  }

  const total = cpus.map(({ times }) => {
    if (!times) {
      return Number.NaN
    }
    const values = [times.user, times.nice, times.sys, times.idle, times.irq]
    return values.every((value) => Number.isFinite(value) && value >= 0)
      ? values.reduce((sum, value) => sum + value, 0)
      : Number.NaN
  })
  const idle = cpus.map(({ times }) => times?.idle ?? Number.NaN)
  if (
    total.some((value) => !Number.isFinite(value)) ||
    idle.some((value) => !Number.isFinite(value))
  ) {
    previousCpuSample = null
    return null
  }

  const previous = previousCpuSample
  previousCpuSample = { total, idle }
  if (!previous || previous.total.length !== total.length) {
    return null
  }

  let totalDelta = 0
  let idleDelta = 0
  for (let index = 0; index < total.length; index += 1) {
    const cpuTotalDelta = total[index] - previous.total[index]
    const cpuIdleDelta = idle[index] - previous.idle[index]
    if (cpuTotalDelta < 0 || cpuIdleDelta < 0) {
      return null
    }
    totalDelta += cpuTotalDelta
    idleDelta += cpuIdleDelta
  }
  return totalDelta > 0 ? Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100)) : null
}

export function parseNvidiaSmiMetrics(stdout: string): HostGpuMetrics | null {
  const lines = stdout.trim().split(/\r?\n/)
  const rows = lines.map((line) => line.split(',').map((field) => field.trim()))
  if (lines.length === 0 || rows.some((fields) => fields.length !== 3)) {
    return null
  }

  const utilizationValues = rows.map(([value]) => parseBoundedNumber(value, 100))
  const usedValues = rows.map(([, value]) => parseBoundedNumber(value))
  const totalValues = rows.map(([, , value]) => parseBoundedNumber(value))
  const utilizationPercent = utilizationValues.every((value): value is number => value !== null)
    ? utilizationValues.reduce((sum, value) => sum + value, 0) / utilizationValues.length
    : null
  const memoryUsed = usedValues.every((value): value is number => value !== null)
    ? usedValues.reduce((sum, value) => sum + value, 0) * 1024 * 1024
    : null
  const memoryTotal = totalValues.every((value): value is number => value !== null && value > 0)
    ? totalValues.reduce((sum, value) => sum + value, 0) * 1024 * 1024
    : null

  if (utilizationPercent === null && memoryUsed === null && memoryTotal === null) {
    return null
  }
  return { utilizationPercent, memoryUsed, memoryTotal, source: 'nvidia-smi' }
}

async function readGpuMetrics(platform: NodeJS.Platform): Promise<HostGpuMetrics> {
  if (platform !== 'win32' && platform !== 'darwin' && platform !== 'linux') {
    return unavailableGpuMetrics()
  }
  try {
    const result = await runProcess({
      program: 'nvidia-smi',
      args: [
        '--query-gpu=utilization.gpu,memory.used,memory.total',
        '--format=csv,noheader,nounits'
      ],
      maxOutputBytes: GPU_QUERY_MAX_BUFFER,
      timeoutMs: GPU_QUERY_TIMEOUT_MS
    })
    if (result.code !== 0 || result.timedOut) {
      return unavailableGpuMetrics()
    }
    return parseNvidiaSmiMetrics(result.stdout) ?? unavailableGpuMetrics()
  } catch {
    return unavailableGpuMetrics()
  }
}

function parseBoundedNumber(value: string, maximum = Number.MAX_SAFE_INTEGER): number | null {
  if (value.trim() === '') {
    return null
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= maximum ? parsed : null
}

function unavailableGpuMetrics(): HostGpuMetrics {
  return {
    utilizationPercent: null,
    memoryUsed: null,
    memoryTotal: null,
    source: 'unavailable'
  }
}

export function parseDarwinAvailableMemory(stdout: string, total: number): number | null {
  const match = /System-wide memory free percentage:\s*(\d+)%/.exec(stdout)
  const percentage = Number.parseInt(match?.[1] ?? '', 10)
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100 || total <= 0) {
    return null
  }
  return Math.round((total * percentage) / 100)
}

export function parseLinuxAvailableMemory(meminfo: string): number | null {
  const match = /^MemAvailable:\s*(\d+)\s+kB$/m.exec(meminfo)
  const kib = Number.parseInt(match?.[1] ?? '', 10)
  if (!Number.isSafeInteger(kib) || kib < 0 || kib > Number.MAX_SAFE_INTEGER / KIB) {
    return null
  }
  return kib * KIB
}

async function readAvailableMemory(
  platform: NodeJS.Platform,
  total: number
): Promise<{ bytes: number; source: HostAvailableMemorySource } | null> {
  if (platform === 'darwin' && darwinAvailabilitySupported) {
    const bytes = await readDarwinAvailableMemory(total)
    if (bytes !== null) {
      return { bytes, source: 'memory-pressure' }
    }
  }
  if (platform === 'linux' && linuxAvailabilitySupported) {
    const bytes = await readLinuxAvailableMemory()
    if (bytes !== null) {
      return { bytes, source: 'proc-meminfo' }
    }
  }
  return null
}

async function readDarwinAvailableMemory(total: number): Promise<number | null> {
  try {
    const result = await runProcess({
      program: '/usr/bin/memory_pressure',
      args: ['-Q'],
      env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
      maxOutputBytes: MEMORY_PRESSURE_MAX_BUFFER,
      timeoutMs: MEMORY_PRESSURE_TIMEOUT_MS
    })
    if (result.code === 0 && !result.timedOut) {
      const available = parseDarwinAvailableMemory(result.stdout, total)
      if (available !== null) {
        return available
      }
    }
  } catch {
    // Older/restricted hosts may lack this command; fall back to Node.
  }
  darwinAvailabilitySupported = false
  return null
}

async function readLinuxAvailableMemory(): Promise<number | null> {
  try {
    const meminfo = await readFile(path.join(path.sep, 'proc', 'meminfo'), 'utf8')
    const available = parseLinuxAvailableMemory(meminfo)
    if (available !== null) {
      return available
    }
  } catch {
    // Non-procfs Linux hosts use Node's memory value.
  }
  linuxAvailabilitySupported = false
  return null
}

function nonNegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
}
