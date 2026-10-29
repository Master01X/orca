import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, FileUp, LoaderCircle, Trash2 } from 'lucide-react'
import type {
  CustomAgentProfile,
  CustomAgentProfilesResult
} from '../../../../shared/custom-agent-profiles'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import { SettingsSubsectionHeader } from './SettingsFormControls'

export function CustomAgentProfilesSetting(): React.JSX.Element {
  const fileInput = useRef<HTMLInputElement>(null)
  const [profiles, setProfiles] = useState<CustomAgentProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const applyResult = useCallback((result: CustomAgentProfilesResult): boolean => {
    if (result.ok) {
      setProfiles(result.profiles)
      setError(null)
      return true
    }
    setError(result.error)
    return false
  }, [])

  useEffect(() => {
    let active = true
    void window.api.customAgentProfiles
      .list()
      .then((result) => {
        if (active) {
          applyResult(result)
          setLoading(false)
        }
      })
      .catch(() => {
        if (active) {
          setError(
            translate('settings.agents.profiles.loadFailed', 'Agent profiles could not be loaded.')
          )
          setLoading(false)
        }
      })
    return () => {
      active = false
    }
  }, [applyResult])

  const importFile = async (file: File | undefined): Promise<void> => {
    if (!file) {
      return
    }
    if (file.size > 64 * 1024) {
      setError(
        translate(
          'settings.agents.profiles.fileTooLarge',
          'Agent profile JSON must be 64 KB or smaller.'
        )
      )
      return
    }
    setBusy(true)
    try {
      applyResult(await window.api.customAgentProfiles.importJson({ contents: await file.text() }))
    } catch {
      setError(
        translate('settings.agents.profiles.importFailed', 'Agent profile could not be imported.')
      )
    } finally {
      setBusy(false)
      if (fileInput.current) {
        fileInput.current.value = ''
      }
    }
  }

  const updateProfile = async (
    resultPromise: Promise<CustomAgentProfilesResult>,
    fallback: string
  ): Promise<boolean> => {
    setBusy(true)
    try {
      return applyResult(await resultPromise)
    } catch {
      setError(fallback)
      return false
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={translate('settings.agents.profiles.title', 'Custom agent profiles')}
      />
      <p className="max-w-2xl text-xs text-muted-foreground">
        {translate(
          'settings.agents.profiles.description',
          'Import JSON profiles for Claude Code or Codex. Provider keys are entered here and encrypted with OS-backed safeStorage. OpenRouter, NVIDIA NIM, and OmniRoute can be used by entering their compatible model API endpoint.'
        )}
      </p>
      <div className="flex items-center gap-2">
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          className="sr-only"
          aria-label={translate(
            'settings.agents.profiles.chooseFile',
            'Choose a JSON agent profile'
          )}
          onChange={(event) => void importFile(event.currentTarget.files?.[0])}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={busy || loading}
          onClick={() => fileInput.current?.click()}
        >
          {busy ? (
            <LoaderCircle className="mr-1.5 size-3.5 animate-spin" />
          ) : (
            <FileUp className="mr-1.5 size-3.5" />
          )}
          {translate('settings.agents.profiles.import', 'Import JSON profile')}
        </Button>
        {loading ? (
          <span className="text-xs text-muted-foreground">
            {translate('settings.agents.profiles.loading', 'Loading profiles…')}
          </span>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {profiles.length === 0 && !loading ? (
        <p className="text-xs text-muted-foreground">
          {translate(
            'settings.agents.profiles.empty',
            'No profiles yet. Import a JSON file with version, name, launcher, protocol, endpointUrl, and model. Keep API keys out of the file.'
          )}
        </p>
      ) : null}
      <div className="space-y-3">
        {profiles.map((profile) => (
          <CustomAgentProfileEditor
            key={profile.id}
            profile={profile}
            disabled={busy}
            onSave={(draft) =>
              updateProfile(
                window.api.customAgentProfiles.save(draft),
                translate('settings.agents.profiles.saveFailed', 'Profile could not be saved.')
              )
            }
            onSetDefault={() =>
              updateProfile(
                window.api.customAgentProfiles.setDefault({ id: profile.id }),
                translate('settings.agents.profiles.selectFailed', 'Profile could not be selected.')
              )
            }
            onRemove={() =>
              updateProfile(
                window.api.customAgentProfiles.remove({ id: profile.id }),
                translate('settings.agents.profiles.removeFailed', 'Profile could not be removed.')
              )
            }
          />
        ))}
      </div>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">
          {translate('settings.agents.profiles.jsonShape', 'Profile JSON shape')}
        </summary>
        <pre className="mt-2 overflow-x-auto rounded-md border border-border/60 bg-muted/30 p-2 text-[11px]">
          {translate(
            'settings.agents.profiles.jsonExample',
            `{
  "version": 1,
  "name": "OpenRouter GPT",
  "launcher": "codex",
  "protocol": "openai-compatible",
  "endpointUrl": "https://openrouter.ai/api/v1",
  "model": "openai/gpt-4.1"
}`
          )}
        </pre>
      </details>
    </section>
  )
}

function CustomAgentProfileEditor({
  profile,
  disabled,
  onSave,
  onSetDefault,
  onRemove
}: {
  profile: CustomAgentProfile
  disabled: boolean
  onSave: (draft: {
    id: string
    endpointUrl: string
    model: string
    apiKey: string
  }) => Promise<boolean>
  onSetDefault: () => void
  onRemove: () => void
}): React.JSX.Element {
  const [endpointUrl, setEndpointUrl] = useState(profile.endpointUrl)
  const [model, setModel] = useState(profile.model)
  const [apiKey, setApiKey] = useState('')

  return (
    <form
      className="space-y-3 rounded-md border border-border/60 bg-background/40 p-3"
      onSubmit={(event) => {
        event.preventDefault()
        void onSave({ id: profile.id, endpointUrl, model, apiKey }).then((saved) => {
          if (saved) {
            setApiKey('')
          }
        })
      }}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm font-medium">{profile.name}</span>
        <span className="text-xs text-muted-foreground">
          {profile.launcher} · {profile.protocol}
        </span>
        {profile.isDefault ? (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
            {translate('settings.agents.profiles.default', 'Default for new launches')}
          </span>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="ml-auto size-7"
          disabled={disabled}
          onClick={onRemove}
          aria-label={translate('settings.agents.profiles.remove', 'Remove {{name}}', {
            name: profile.name
          })}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      {profile.description ? (
        <p className="text-xs text-muted-foreground">{profile.description}</p>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1 text-xs">
          <span>{translate('settings.agents.profiles.endpoint', 'Model API endpoint')}</span>
          <Input value={endpointUrl} onChange={(event) => setEndpointUrl(event.target.value)} />
        </label>
        <label className="space-y-1 text-xs">
          <span>{translate('settings.agents.profiles.model', 'Model')}</span>
          <Input value={model} onChange={(event) => setModel(event.target.value)} />
        </label>
        <label className="space-y-1 text-xs sm:col-span-2">
          <span>
            {translate('settings.agents.profiles.apiKey', 'Provider API key')}
            {profile.hasApiKey
              ? ` ${translate('settings.agents.profiles.keepKey', '(saved; leave blank to keep)')}`
              : ''}
          </span>
          <Input
            type="password"
            autoComplete="new-password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={
              profile.hasApiKey
                ? '••••••••'
                : translate('settings.agents.profiles.enterApiKey', 'Enter an API key')
            }
          />
        </label>
      </div>
      <div className="flex justify-end gap-2">
        {!profile.isDefault ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={onSetDefault}
          >
            {translate('settings.agents.profiles.useForLaunches', 'Use for new launches')}
          </Button>
        ) : null}
        <Button type="submit" size="sm" disabled={disabled}>
          <Check className="mr-1.5 size-3.5" />
          {translate('settings.agents.profiles.save', 'Save profile')}
        </Button>
      </div>
    </form>
  )
}
