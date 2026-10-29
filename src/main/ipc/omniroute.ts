import { app, ipcMain } from 'electron'
import type { OmniRouteServiceDraft } from '../../shared/omniroute-api'
import { OmniRouteClient } from '../omniroute/omniroute-client'
import { OmniRouteConfigStore } from '../omniroute/omniroute-config-store'

let client: OmniRouteClient | null = null

function getClient(): OmniRouteClient {
  if (!client) {
    client = new OmniRouteClient(new OmniRouteConfigStore(app.getPath('userData')))
  }
  return client
}

export function registerOmniRouteHandlers(): void {
  ipcMain.handle('omniroute:get-services', () => {
    try {
      return { ok: true, services: getClient().getServices() }
    } catch (error) {
      return { ok: false, error: safeError(error) }
    }
  })

  ipcMain.handle('omniroute:save-service', (_event, draft: OmniRouteServiceDraft) => {
    if (
      typeof draft?.name !== 'string' ||
      typeof draft?.baseUrl !== 'string' ||
      (draft.id !== undefined && typeof draft.id !== 'string') ||
      (draft.bearerToken !== undefined && typeof draft.bearerToken !== 'string')
    ) {
      return { ok: false, error: 'Service name and HTTPS base URL are required.' }
    }
    try {
      return {
        ok: true,
        services: getClient().saveService(draft)
      }
    } catch (error) {
      return { ok: false, error: safeError(error) }
    }
  })

  ipcMain.handle('omniroute:clear-bearer-token', (_event, args: { id?: string }) => {
    if (typeof args?.id !== 'string' || !args.id) {
      return { ok: false, error: 'Service ID is required.' }
    }
    try {
      return {
        ok: true,
        services: getClient().clearBearerToken(args.id)
      }
    } catch (error) {
      return { ok: false, error: safeError(error) }
    }
  })

  ipcMain.handle('omniroute:remove-service', (_event, args: { id?: string }) => {
    if (typeof args?.id !== 'string' || !args.id) {
      return { ok: false, error: 'Service ID is required.' }
    }
    try {
      return {
        ok: true,
        services: getClient().removeService(args.id)
      }
    } catch (error) {
      return { ok: false, error: safeError(error) }
    }
  })

  ipcMain.handle('omniroute:refresh-service', async (_event, args: { id?: string }) => {
    if (typeof args?.id !== 'string' || !args.id) {
      throw new Error('Service ID is required.')
    }
    return getClient().refreshService(args.id)
  })
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : 'OmniRoute request failed.'
}
