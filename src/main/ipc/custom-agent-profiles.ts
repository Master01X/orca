import { app, ipcMain } from 'electron'
import type { CustomAgentProfileSave } from '../../shared/custom-agent-profiles'
import { CustomAgentProfileStore } from '../custom-agents/custom-agent-profile-store'

let store: CustomAgentProfileStore | null = null

function getStore(): CustomAgentProfileStore {
  store ??= new CustomAgentProfileStore(app.getPath('userData'))
  return store
}

export function registerCustomAgentProfileHandlers(): void {
  ipcMain.handle('custom-agent-profiles:list', () => run(() => getStore().list()))

  ipcMain.handle('custom-agent-profiles:import-json', (_event, args: { contents?: unknown }) => {
    if (typeof args?.contents !== 'string') {
      return { ok: false, error: 'Select a JSON agent profile.' }
    }
    const contents = args.contents
    return run(() => getStore().importJson(contents))
  })

  ipcMain.handle('custom-agent-profiles:save', (_event, draft: Partial<CustomAgentProfileSave>) => {
    if (
      typeof draft?.id !== 'string' ||
      typeof draft.endpointUrl !== 'string' ||
      typeof draft.model !== 'string' ||
      (draft.apiKey !== undefined && typeof draft.apiKey !== 'string')
    ) {
      return { ok: false, error: 'Profile ID, endpoint, model, and API key are required.' }
    }
    const safeDraft: CustomAgentProfileSave = {
      id: draft.id,
      endpointUrl: draft.endpointUrl,
      model: draft.model,
      ...(draft.apiKey !== undefined ? { apiKey: draft.apiKey } : {})
    }
    return run(() => getStore().save(safeDraft))
  })

  ipcMain.handle('custom-agent-profiles:set-default', (_event, args: { id?: unknown }) => {
    if (typeof args?.id !== 'string' || !args.id) {
      return { ok: false, error: 'Profile ID is required.' }
    }
    const id = args.id
    return run(() => getStore().setDefault(id))
  })

  ipcMain.handle('custom-agent-profiles:remove', (_event, args: { id?: unknown }) => {
    if (typeof args?.id !== 'string' || !args.id) {
      return { ok: false, error: 'Profile ID is required.' }
    }
    const id = args.id
    return run(() => getStore().remove(id))
  })
}

function run(profiles: () => ReturnType<CustomAgentProfileStore['list']>) {
  try {
    return { ok: true as const, profiles: profiles() }
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : 'Agent profiles could not be updated.'
    }
  }
}
