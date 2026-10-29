import type { OmniRouteEndpointResult } from '../../../../shared/omniroute-api'
import { translate } from '@/i18n/i18n'

export function OmniRouteEndpointStatus(props: {
  label: string
  result: OmniRouteEndpointResult
}): React.JSX.Element {
  const content = props.result.ok ? formatResponse(props.result.data) : props.result.error
  const status = props.result.ok
    ? translate('auto.components.settings.omniroute.httpStatus', 'HTTP {{statusCode}}', {
        statusCode: props.result.statusCode
      })
    : translate('auto.components.settings.omniroute.unavailable', 'Unavailable')
  return (
    <details className="rounded border border-border/60 px-2.5 py-2">
      <summary className="cursor-pointer text-xs font-medium">
        {props.label}: {status}
      </summary>
      <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-2xs text-muted-foreground scrollbar-sleek">
        {content}
      </pre>
    </details>
  )
}

function formatResponse(value: unknown): string {
  const serialized = JSON.stringify(value, null, 2)
  if (!serialized) {
    return 'No response data.'
  }
  return serialized.length > 8000 ? `${serialized.slice(0, 8000)}\n…` : serialized
}
