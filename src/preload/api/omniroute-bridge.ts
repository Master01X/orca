import { ipcRenderer } from 'electron'
import type { OmniRouteApi } from '../../shared/omniroute-api'

export const omniRouteApi = {
  getServices: () => ipcRenderer.invoke('omniroute:get-services'),
  saveService: (draft) => ipcRenderer.invoke('omniroute:save-service', draft),
  clearBearerToken: (args) => ipcRenderer.invoke('omniroute:clear-bearer-token', args),
  removeService: (args) => ipcRenderer.invoke('omniroute:remove-service', args),
  refreshService: (args) => ipcRenderer.invoke('omniroute:refresh-service', args)
} satisfies OmniRouteApi
