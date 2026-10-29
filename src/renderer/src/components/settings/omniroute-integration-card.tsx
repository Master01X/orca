import { useEffect, useState } from 'react'
import { LoaderCircle, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { IntegrationCardDetails, IntegrationCardShell } from './integration-card-shell'
import type {
  OmniRouteService,
  OmniRouteServiceDraft,
  OmniRouteSnapshot
} from '../../../../shared/omniroute-api'
import { translate } from '@/i18n/i18n'
import { OmniRouteEndpointStatus } from './OmniRouteEndpointStatus'

export function OmniRouteIntegrationCard(): React.JSX.Element {
  const [services, setServices] = useState<OmniRouteService[] | null>(null)
  const [snapshots, setSnapshots] = useState<Record<string, OmniRouteSnapshot>>({})
  const [busyServices, setBusyServices] = useState<Record<string, boolean>>({})
  const [newServiceOpen, setNewServiceOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadServices = async (): Promise<void> => {
    try {
      const result = await window.api.omniRoute.getServices()
      if (result.ok) {
        setServices(result.services)
        setError(null)
      } else {
        setError(result.error)
      }
    } catch {
      setError('OmniRoute settings could not be loaded.')
    }
  }

  useEffect(() => {
    let active = true
    void window.api.omniRoute
      .getServices()
      .then((result) => {
        if (!active) {
          return
        }
        if (result.ok) {
          setServices(result.services)
        } else {
          setError(result.error)
        }
      })
      .catch(() => {
        if (active) {
          setError('OmniRoute settings could not be loaded.')
        }
      })
    return () => {
      active = false
    }
  }, [])

  const saveService = async (draft: OmniRouteServiceDraft): Promise<boolean> => {
    try {
      const result = await window.api.omniRoute.saveService(draft)
      if (!result.ok) {
        setError(result.error)
        return false
      }
      setServices(result.services)
      if (draft.id) {
        const serviceId = draft.id
        setSnapshots((previous) => {
          const next = { ...previous }
          delete next[serviceId]
          return next
        })
      }
      setError(null)
      return true
    } catch {
      setError('OmniRoute settings could not be saved.')
      return false
    }
  }

  const removeService = async (id: string): Promise<void> => {
    try {
      const result = await window.api.omniRoute.removeService({ id })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setServices(result.services)
      setSnapshots((previous) => {
        const next = { ...previous }
        delete next[id]
        return next
      })
      setError(null)
    } catch {
      setError('OmniRoute deployment could not be removed.')
    }
  }

  const clearBearerToken = async (id: string): Promise<void> => {
    try {
      const result = await window.api.omniRoute.clearBearerToken({ id })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setServices(result.services)
      setSnapshots((previous) => {
        const next = { ...previous }
        delete next[id]
        return next
      })
      setError(null)
    } catch {
      setError('OmniRoute bearer token could not be cleared.')
    }
  }

  const refreshService = async (id: string): Promise<void> => {
    setBusyServices((previous) => ({ ...previous, [id]: true }))
    setError(null)
    try {
      const snapshot = await window.api.omniRoute.refreshService({ id })
      setSnapshots((previous) => ({ ...previous, [id]: snapshot }))
    } catch {
      setError('Could not refresh this OmniRoute service.')
    } finally {
      setBusyServices((previous) => ({ ...previous, [id]: false }))
    }
  }

  return (
    <IntegrationCardShell
      icon={<RefreshCw className="size-5" />}
      name="OmniRoute"
      description={translate(
        'auto.components.settings.omniroute.description',
        'Monitor deployment health, model catalog and rate limits. Custom agent profiles route inference only through the compatible endpoint you explicitly configure.'
      )}
      statusLabel={
        services === null
          ? translate('auto.components.settings.omniroute.loading', 'Loading')
          : translate(
              'auto.components.settings.omniroute.deploymentCount',
              '{{count}} deployments',
              { count: services.length }
            )
      }
      statusTone="neutral"
      checking={services === null}
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={() => setNewServiceOpen((open) => !open)}
          disabled={services === null}
        >
          <Plus className="mr-1.5 size-3.5" />
          {translate('auto.components.settings.omniroute.addDeployment', 'Add deployment')}
        </Button>
      }
    >
      <IntegrationCardDetails>
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.settings.omniroute.securityNote',
            'Requests use GET only. Bearer tokens are encrypted with OS safeStorage. A local cap of 60 requests per minute applies to each service.'
          )}
        </p>
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
        {services === null ? (
          <Button variant="ghost" size="sm" onClick={() => void loadServices()}>
            {translate('auto.components.settings.omniroute.retry', 'Retry')}
          </Button>
        ) : (
          <div className="space-y-4">
            {services.map((service) => (
              <OmniRouteServiceEditor
                key={service.id}
                service={service}
                snapshot={snapshots[service.id]}
                saving={busyServices[service.id] === true}
                onSave={saveService}
                onRemove={removeService}
                onClearToken={clearBearerToken}
                onRefresh={refreshService}
              />
            ))}
            {newServiceOpen ? (
              <OmniRouteServiceEditor
                key="new-service"
                saving={busyServices.new === true}
                onSave={async (draft) => {
                  const saved = await saveService(draft)
                  if (saved) {
                    setNewServiceOpen(false)
                  }
                  return saved
                }}
                onCancel={() => setNewServiceOpen(false)}
              />
            ) : null}
          </div>
        )}
      </IntegrationCardDetails>
    </IntegrationCardShell>
  )
}

function OmniRouteServiceEditor(props: {
  service?: OmniRouteService
  snapshot?: OmniRouteSnapshot
  saving: boolean
  onSave: (draft: OmniRouteServiceDraft) => Promise<boolean>
  onRemove?: (id: string) => Promise<void>
  onClearToken?: (id: string) => Promise<void>
  onRefresh?: (id: string) => Promise<void>
  onCancel?: () => void
}): React.JSX.Element {
  const [name, setName] = useState(props.service?.name ?? '')
  const [baseUrl, setBaseUrl] = useState(props.service?.baseUrl ?? '')
  const [bearerToken, setBearerToken] = useState('')
  const [saving, setSaving] = useState(false)
  const formId = `omniroute-${props.service?.id ?? 'new'}`
  const requestBusy = props.saving || saving
  const serviceId = props.service?.id

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setSaving(true)
    const saved = await props.onSave({
      ...(props.service ? { id: props.service.id } : {}),
      name,
      baseUrl,
      bearerToken
    })
    if (saved) {
      setBearerToken('')
    }
    setSaving(false)
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="space-y-3 rounded-md border border-border/60 bg-background/40 p-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs font-medium">
          <span>{translate('auto.components.settings.omniroute.serviceName', 'Service name')}</span>
          <Input
            id={`${formId}-name`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            required
            disabled={requestBusy}
          />
        </label>
        <label className="space-y-1 text-xs font-medium">
          <span>{translate('auto.components.settings.omniroute.baseUrl', 'Base URL')}</span>
          <Input
            id={`${formId}-url`}
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            type="url"
            placeholder={translate(
              'auto.components.settings.omniroute.exampleBaseUrl',
              'https://example.com'
            )}
            required
            disabled={requestBusy}
          />
        </label>
      </div>
      <label className="block space-y-1 text-xs font-medium">
        <span>{translate('auto.components.settings.omniroute.bearerToken', 'Bearer token')}</span>
        <Input
          id={`${formId}-token`}
          value={bearerToken}
          onChange={(event) => setBearerToken(event.target.value)}
          type="password"
          autoComplete="new-password"
          spellCheck={false}
          placeholder={
            props.service?.hasToken
              ? translate(
                  'auto.components.settings.omniroute.keepToken',
                  'Leave blank to keep the saved token'
                )
              : translate(
                  'auto.components.settings.omniroute.enterToken',
                  'Enter token to enable authenticated endpoints'
                )
          }
          disabled={requestBusy}
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="outline" size="sm" disabled={requestBusy}>
          {saving ? <LoaderCircle className="mr-1.5 size-3.5 animate-spin" /> : null}
          {translate('auto.components.settings.omniroute.save', 'Save')}
        </Button>
        {serviceId && props.onRefresh ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={requestBusy}
            onClick={() => void props.onRefresh?.(serviceId)}
          >
            {props.saving ? <LoaderCircle className="mr-1.5 size-3.5 animate-spin" /> : null}
            {translate(
              'auto.components.settings.omniroute.refresh',
              'Refresh health, models and rate limits'
            )}
          </Button>
        ) : null}
        {props.service?.hasToken && serviceId && props.onClearToken ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={requestBusy}
            onClick={() => void props.onClearToken?.(serviceId)}
          >
            {translate('auto.components.settings.omniroute.clearToken', 'Clear token')}
          </Button>
        ) : null}
        {serviceId && props.onRemove ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={requestBusy}
            onClick={() => void props.onRemove?.(serviceId)}
          >
            <Trash2 className="mr-1.5 size-3.5" />
            {translate('auto.components.settings.omniroute.remove', 'Remove')}
          </Button>
        ) : null}
        {props.onCancel ? (
          <Button type="button" variant="ghost" size="sm" onClick={props.onCancel}>
            {translate('auto.components.settings.omniroute.cancel', 'Cancel')}
          </Button>
        ) : null}
        <span className="text-xs text-muted-foreground">
          {props.service?.hasToken
            ? translate(
                'auto.components.settings.omniroute.tokenStored',
                'Bearer token stored with OS-backed encryption.'
              )
            : translate('auto.components.settings.omniroute.noToken', 'No bearer token saved.')}
        </span>
      </div>
      {props.snapshot ? (
        <div className="space-y-2 border-t border-border/60 pt-3">
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.omniroute.budget',
              '{{remaining}} of {{limit}} local requests remain in the current minute.',
              {
                remaining: props.snapshot.requestBudget.remaining,
                limit: props.snapshot.requestBudget.limit
              }
            )}
          </p>
          <OmniRouteEndpointStatus
            label={translate('auto.components.settings.omniroute.health', 'Health')}
            result={props.snapshot.health}
          />
          <OmniRouteEndpointStatus
            label={translate('auto.components.settings.omniroute.modelCatalog', 'Model catalog')}
            result={props.snapshot.models}
          />
          <OmniRouteEndpointStatus
            label={translate('auto.components.settings.omniroute.rateLimits', 'Rate limits')}
            result={props.snapshot.rateLimits}
          />
        </div>
      ) : null}
    </form>
  )
}
