import { ipcRenderer } from 'electron'
import type { CustomAgentProfileApi } from '../../shared/custom-agent-profiles'

export const customAgentProfilesApi = {
  list: () => ipcRenderer.invoke('custom-agent-profiles:list'),
  importJson: (args) => ipcRenderer.invoke('custom-agent-profiles:import-json', args),
  save: (draft) => ipcRenderer.invoke('custom-agent-profiles:save', draft),
  setDefault: (args) => ipcRenderer.invoke('custom-agent-profiles:set-default', args),
  remove: (args) => ipcRenderer.invoke('custom-agent-profiles:remove', args)
} satisfies CustomAgentProfileApi
