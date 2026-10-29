import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getSecretStore } from '../../shared/secret-store'
import {
  containsControlCharacter,
  isStoredConfig,
  normalizeEndpointUrl,
  normalizeModel,
  parseDefinition,
  toPublicProfile,
  type StoredConfig,
  type StoredProfile
} from './custom-agent-profile-validation'
import type {
  CustomAgentLaunchProfile,
  CustomAgentProfile,
  CustomAgentProfileSave
} from '../../shared/custom-agent-profiles'
import { hardenExistingSecureFile, writeSecureFile } from '../../shared/secure-file'

export type CustomAgentProfileStorage = {
  exists: (path: string) => boolean
  read: (path: string) => string
  harden: (path: string) => void
  write: (path: string, contents: string) => boolean
}

const storage: CustomAgentProfileStorage = {
  exists: existsSync,
  read: (path) => readFileSync(path, 'utf8'),
  harden: hardenExistingSecureFile,
  write: writeSecureFile
}

const PROFILE_FILE = 'custom-agent-profiles.json'
const IMPORT_MAX_BYTES = 64 * 1024
const API_KEY_MAX_LENGTH = 8192

export class CustomAgentProfileStore {
  private readonly configPath: string

  constructor(
    userDataPath: string,
    private readonly fileStorage: CustomAgentProfileStorage = storage
  ) {
    this.configPath = join(userDataPath, PROFILE_FILE)
  }

  list(): CustomAgentProfile[] {
    return this.readConfig().profiles.map(toPublicProfile)
  }

  importJson(contents: string): CustomAgentProfile[] {
    if (Buffer.byteLength(contents, 'utf8') > IMPORT_MAX_BYTES) {
      throw new Error('Agent profile JSON must be 64 KB or smaller.')
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(contents)
    } catch {
      throw new Error('Agent profile must contain valid JSON.')
    }
    const profile = parseDefinition(parsed)
    const config = this.readConfig()
    if (config.profiles.length >= 100) {
      throw new Error('You can store up to 100 custom agent profiles.')
    }
    const inserted: StoredProfile = {
      ...profile,
      id: randomUUID(),
      isDefault: false
    }
    this.writeConfig({ version: 1, profiles: [...config.profiles, inserted] })
    return this.list()
  }

  save(draft: CustomAgentProfileSave): CustomAgentProfile[] {
    const config = this.readConfig()
    const existing = config.profiles.find((profile) => profile.id === draft.id)
    if (!existing) {
      throw new Error('This agent profile no longer exists.')
    }
    const endpointUrl = normalizeEndpointUrl(draft.endpointUrl)
    const model = normalizeModel(draft.model)
    if (!endpointUrl || !model) {
      throw new Error('Enter a valid HTTPS (or localhost HTTP) endpoint and model name.')
    }

    let apiKeyCiphertext = existing.apiKeyCiphertext
    const apiKey = draft.apiKey?.trim()
    if (apiKey) {
      if (apiKey.length > API_KEY_MAX_LENGTH || containsControlCharacter(apiKey)) {
        throw new Error('API key must be a single line of at most 8192 characters.')
      }
      const secrets = getSecretStore()
      if (!secrets.isEncryptionAvailable()) {
        throw new Error('OS-backed encryption is unavailable; the API key was not stored.')
      }
      try {
        apiKeyCiphertext = secrets.encryptString(apiKey).toString('base64')
      } catch {
        throw new Error('API key could not be stored securely.')
      }
    }

    const profiles = config.profiles.map((profile) =>
      profile.id === existing.id
        ? { ...profile, endpointUrl, model, ...(apiKeyCiphertext ? { apiKeyCiphertext } : {}) }
        : profile
    )
    this.writeConfig({ version: 1, profiles })
    return profiles.map(toPublicProfile)
  }

  setDefault(id: string): CustomAgentProfile[] {
    const config = this.readConfig()
    const selected = config.profiles.find((profile) => profile.id === id)
    if (!selected) {
      throw new Error('This agent profile no longer exists.')
    }
    if (!selected.apiKeyCiphertext) {
      throw new Error('Add an API key before using this profile for new launches.')
    }
    const profiles = config.profiles.map((profile) => ({
      ...profile,
      isDefault: profile.launcher === selected.launcher && profile.id === selected.id
    }))
    this.writeConfig({ version: 1, profiles })
    return profiles.map(toPublicProfile)
  }

  remove(id: string): CustomAgentProfile[] {
    const config = this.readConfig()
    const profiles = config.profiles.filter((profile) => profile.id !== id)
    if (profiles.length === config.profiles.length) {
      throw new Error('This agent profile no longer exists.')
    }
    this.writeConfig({ version: 1, profiles })
    return profiles.map(toPublicProfile)
  }

  getLaunchProfile(launcher: string | undefined): CustomAgentLaunchProfile | null {
    if (launcher === 'claude-agent-teams') {
      launcher = 'claude'
    }
    if (launcher !== 'claude' && launcher !== 'codex') {
      return null
    }
    const profile = this.readConfig().profiles.find(
      (candidate) => candidate.launcher === launcher && candidate.isDefault
    )
    if (!profile) {
      return null
    }
    if (!profile.apiKeyCiphertext) {
      throw new Error(`The default ${launcher} API profile has no saved API key.`)
    }
    const secrets = getSecretStore()
    if (!secrets.isEncryptionAvailable()) {
      throw new Error('OS-backed encryption is unavailable; the agent profile cannot be unlocked.')
    }
    let apiKey: string
    try {
      apiKey = secrets.decryptString(Buffer.from(profile.apiKeyCiphertext, 'base64'))
    } catch {
      throw new Error(
        `The saved ${launcher} API key could not be decrypted. Replace it in Settings.`
      )
    }
    return {
      launcher: profile.launcher,
      protocol: profile.protocol,
      endpointUrl: profile.endpointUrl,
      model: profile.model,
      apiKey
    }
  }

  private readConfig(): StoredConfig {
    if (!this.fileStorage.exists(this.configPath)) {
      return { version: 1, profiles: [] }
    }
    try {
      this.fileStorage.harden(this.configPath)
      const parsed: unknown = JSON.parse(this.fileStorage.read(this.configPath))
      if (!isStoredConfig(parsed)) {
        throw new Error('Invalid config')
      }
      return parsed
    } catch {
      throw new Error('Stored agent profiles could not be read; they were left unchanged.')
    }
  }

  private writeConfig(config: StoredConfig): void {
    try {
      if (!this.fileStorage.write(this.configPath, JSON.stringify(config, null, 2))) {
        throw new Error('File protection unavailable')
      }
    } catch {
      throw new Error('Agent profiles could not be saved securely.')
    }
  }
}
