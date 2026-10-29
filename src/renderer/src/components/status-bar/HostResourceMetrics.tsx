import React from 'react'
import { translate } from '@/i18n/i18n'
import type { HostMemory } from '../../../../shared/process-stats-types'
import { formatMemory } from './resource-usage-metrics'

export function HostResourceMetrics({ host }: { host: HostMemory }): React.JSX.Element {
  const cpu =
    typeof host.cpuUsagePercent === 'number' && Number.isFinite(host.cpuUsagePercent)
      ? `${translate('resourceManager.hostCpu', 'Host CPU')} ${host.cpuUsagePercent.toFixed(1)}%`
      : translate('resourceManager.hostCpuUnavailable', 'Host CPU unavailable')
  const ram =
    host.totalMemory > 0
      ? `${translate('resourceManager.hostRam', 'Host RAM')} ${host.memoryUsagePercent.toFixed(1)}% (${formatMemory(host.usedMemory)} / ${formatMemory(host.totalMemory)})`
      : translate('resourceManager.hostRamUnavailable', 'Host RAM unavailable')
  const gpu =
    !host.gpu || host.gpu.source === 'unavailable'
      ? translate('resourceManager.gpuUnavailable', 'GPU unavailable')
      : typeof host.gpu.utilizationPercent === 'number'
        ? `${translate('resourceManager.gpu', 'GPU')} ${host.gpu.utilizationPercent.toFixed(1)}%`
        : translate('resourceManager.gpuUtilizationUnavailable', 'GPU utilization unavailable')
  const vram =
    host.gpu &&
    typeof host.gpu.memoryUsed === 'number' &&
    typeof host.gpu.memoryTotal === 'number' &&
    host.gpu.memoryTotal > 0
      ? `${translate('resourceManager.gpuMemory', 'VRAM')} ${formatMemory(host.gpu.memoryUsed)} / ${formatMemory(host.gpu.memoryTotal)}`
      : null

  return (
    <div
      role="group"
      aria-label={translate('resourceManager.hostResourceUsage', 'Host resource usage')}
      className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-3 py-1 text-2xs tabular-nums text-muted-foreground"
    >
      <span>{cpu}</span>
      <span aria-hidden="true">·</span>
      <span>{ram}</span>
      <span aria-hidden="true">·</span>
      <span>{gpu}</span>
      {vram && (
        <>
          <span aria-hidden="true">·</span>
          <span>{vram}</span>
        </>
      )}
    </div>
  )
}
