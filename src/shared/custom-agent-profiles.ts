import type { TuiAgent } from './tui-agent'

export type CustomAgentLauncher = Extract<TuiAgent, 'claude' | 'codex'>
export type CustomAgentApiProtocol = 'anthropic' | 'openai-compatible'

export type CustomAgentProfileDefinition = {
  version: 1
  name: string
  description?: string
  launcher: CustomAgentLauncher
  protocol: CustomAgentApiProtocol
  endpointUrl: string
  model: string
}

export type CustomAgentProfile = CustomAgentProfileDefinition & {
  id: string
  hasApiKey: boolean
  isDefault: boolean
}

export type CustomAgentProfileSave = {
  id: string
  endpointUrl: string
  model: string
  apiKey?: string
}

export type CustomAgentProfilesResult =
  | { ok: true; profiles: CustomAgentProfile[] }
  | { ok: false; error: string }

export type CustomAgentProfileApi = {
  list: () => Promise<CustomAgentProfilesResult>
  importJson: (args: { contents: string }) => Promise<CustomAgentProfilesResult>
  save: (draft: CustomAgentProfileSave) => Promise<CustomAgentProfilesResult>
  setDefault: (args: { id: string }) => Promise<CustomAgentProfilesResult>
  remove: (args: { id: string }) => Promise<CustomAgentProfilesResult>
}

export type CustomAgentLaunchProfile = {
  launcher: CustomAgentLauncher
  protocol: CustomAgentApiProtocol
  endpointUrl: string
  model: string
  apiKey: string
}
