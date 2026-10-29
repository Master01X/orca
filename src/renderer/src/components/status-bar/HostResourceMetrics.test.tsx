// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createEmptyMemorySnapshot } from '../../web/preload-api/web-memory-api'
import { HostResourceMetrics } from './HostResourceMetrics'

afterEach(cleanup)

describe('HostResourceMetrics', () => {
  it('shows host CPU and RAM samples and reports an unavailable GPU provider explicitly', () => {
    const host = {
      ...createEmptyMemorySnapshot().host,
      totalMemory: 16 * 1024 * 1024 * 1024,
      usedMemory: 8 * 1024 * 1024 * 1024,
      memoryUsagePercent: 50,
      cpuUsagePercent: 34.5
    }

    render(<HostResourceMetrics host={host} />)

    expect(screen.queryByText('Host CPU 34.5%')).not.toBeNull()
    expect(screen.queryByText('Host RAM 50.0% (8.00 GB / 16.00 GB)')).not.toBeNull()
    expect(screen.queryByText('GPU unavailable')).not.toBeNull()
  })

  it('does not describe missing samples as zero utilization', () => {
    render(<HostResourceMetrics host={createEmptyMemorySnapshot().host} />)

    expect(screen.queryByText('Host CPU unavailable')).not.toBeNull()
    expect(screen.queryByText('Host RAM unavailable')).not.toBeNull()
    expect(screen.queryByText('GPU unavailable')).not.toBeNull()
  })

  it('keeps GPU memory separate from GPU utilization', () => {
    const host = {
      ...createEmptyMemorySnapshot().host,
      gpu: {
        utilizationPercent: null,
        memoryUsed: 1024 * 1024 * 1024,
        memoryTotal: 4 * 1024 * 1024 * 1024,
        source: 'nvidia-smi' as const
      }
    }

    render(<HostResourceMetrics host={host} />)

    expect(screen.queryByText('GPU utilization unavailable')).not.toBeNull()
    expect(screen.queryByText('VRAM 1.00 GB / 4.00 GB')).not.toBeNull()
    expect(screen.queryByText('GPU 25.0%')).toBeNull()
  })
})
