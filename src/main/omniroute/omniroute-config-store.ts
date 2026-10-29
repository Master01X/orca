import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getSecretStore } from '../../shared/secret-store'
import {
  OMNIROUTE_DEFAULT_SERVICES,
  type OmniRouteService,
  type OmniRouteServiceDraft
} from '../../shared/omniroute-api'
import { hardenExistingSecureFile, writeSecureFile } from '../../shared/secure-file'

type StoredOmniRouteService = {
  id: string
  name: string
  baseUrl: string
  tokenCiphertext?: string
}

type StoredOmniRouteConfig = {
  version: 1
  services: StoredOmniRouteService[]
}

export type OmniRouteRequestService = OmniRouteService & {
  bearerToken: string | null
  credentialError: string | null
}

const CONFIG_FILE = 'omniroute-services.json'
const TOKEN_MAX_LENGTH = 4096

export type OmniRouteConfigStorage = {
  exists: (path: string) => boolean
  read: (path: string) => string
  harden: (path: string) => void
  write: (path: string, contents: string) => boolean
}

const filesystemStorage: OmniRouteConfigStorage = {
  exists: existsSync,
  read: (path) => readFileSync(path, 'utf8'),
  harden: hardenExistingSecureFile,
  write: writeSecureFile
}

export class OmniRouteConfigStore {
  private readonly configPath: string

  constructor(
    userDataPath: string,
    private readonly storage: OmniRouteConfigStorage = filesystemStorage
  ) {
    this.configPath = join(userDataPath, CONFIG_FILE)
  }

  listServices(): OmniRouteService[] {
    return this.readConfig().services.map(toPublicService)
  }

  saveService(draft: OmniRouteServiceDraft): OmniRouteService[] {
    const name = normalizeName(draft.name)
    const baseUrl = normalizeBaseUrl(draft.baseUrl)
    if (!name || !baseUrl) {
      throw new Error('Enter a service name and a valid HTTPS base URL.')
    }

    const config = this.readConfig()
    const existing = draft.id
      ? config.services.find((service) => service.id === draft.id)
      : undefined
    if (draft.id && !existing) {
      throw new Error('This OmniRoute service no longer exists.')
    }

    let tokenCiphertext = existing?.tokenCiphertext
    const bearerToken = draft.bearerToken?.trim()
    if (bearerToken) {
      if (bearerToken.length > TOKEN_MAX_LENGTH || containsControlCharacter(bearerToken)) {
        throw new Error('Bearer token must be a single line of at most 4096 characters.')
      }
      const secrets = getSecretStore()
      if (!secrets.isEncryptionAvailable()) {
        throw new Error('OS-backed encryption is unavailable; the bearer token was not stored.')
      }
      try {
        tokenCiphertext = secrets.encryptString(bearerToken).toString('base64')
      } catch {
        throw new Error('Bearer token could not be stored securely.')
      }
    }

    const updated: StoredOmniRouteService = {
      id: existing?.id ?? randomUUID(),
      name,
      baseUrl,
      ...(tokenCiphertext ? { tokenCiphertext } : {})
    }
    const services = existing
      ? config.services.map((service) => (service.id === existing.id ? updated : service))
      : [...config.services, updated]
    this.writeConfig({ version: 1, services })
    return services.map(toPublicService)
  }

  removeService(id: string): OmniRouteService[] {
    const config = this.readConfig()
    if (!config.services.some((service) => service.id === id)) {
      throw new Error('This OmniRoute service no longer exists.')
    }
    const services = config.services.filter((service) => service.id !== id)
    this.writeConfig({ version: 1, services })
    return services.map(toPublicService)
  }

  getServiceForRequest(id: string): OmniRouteRequestService | null {
    const service = this.readConfig().services.find((entry) => entry.id === id)
    if (!service) {
      return null
    }
    let bearerToken: string | null = null
    let credentialError: string | null = null
    if (service.tokenCiphertext) {
      try {
        const secrets = getSecretStore()
        if (!secrets.isEncryptionAvailable()) {
          credentialError =
            'OS-backed encryption is unavailable; unlock the keychain to use the saved token.'
        } else {
          bearerToken = secrets.decryptString(Buffer.from(service.tokenCiphertext, 'base64'))
        }
      } catch {
        credentialError = 'Saved bearer token could not be decrypted. Replace it in settings.'
      }
    }
    return {
      ...toPublicService(service),
      bearerToken,
      credentialError
    }
  }

  clearBearerToken(id: string): OmniRouteService[] {
    const config = this.readConfig()
    const service = config.services.find((entry) => entry.id === id)
    if (!service) {
      throw new Error('This OmniRoute service no longer exists.')
    }
    const services = config.services.map((entry) => {
      if (entry.id !== id) {
        return entry
      }
      return { id: entry.id, name: entry.name, baseUrl: entry.baseUrl }
    })
    this.writeConfig({ version: 1, services })
    return services.map(toPublicService)
  }

  private readConfig(): StoredOmniRouteConfig {
    if (!this.storage.exists(this.configPath)) {
      const initial: StoredOmniRouteConfig = {
        version: 1,
        services: OMNIROUTE_DEFAULT_SERVICES.map((service) => ({ ...service }))
      }
      this.writeConfig(initial)
      return initial
    }

    try {
      this.storage.harden(this.configPath)
      const parsed: unknown = JSON.parse(this.storage.read(this.configPath))
      if (!isStoredConfig(parsed)) {
        throw new Error('Invalid config')
      }
      return parsed
    } catch {
      throw new Error('Stored OmniRoute settings could not be read; they were left unchanged.')
    }
  }

  private writeConfig(config: StoredOmniRouteConfig): void {
    try {
      if (!this.storage.write(this.configPath, JSON.stringify(config, null, 2))) {
        throw new Error('File protection unavailable')
      }
    } catch {
      throw new Error('OmniRoute settings could not be saved securely.')
    }
  }
}

function isStoredConfig(value: unknown): value is StoredOmniRouteConfig {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.services)) {
    return false
  }
  return value.services.every(isStoredService)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isStoredService(value: unknown): value is StoredOmniRouteService {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    /^[a-zA-Z0-9._-]{1,128}$/.test(value.id) &&
    typeof value.name === 'string' &&
    normalizeName(value.name) === value.name &&
    typeof value.baseUrl === 'string' &&
    normalizeBaseUrl(value.baseUrl) === value.baseUrl &&
    (value.tokenCiphertext === undefined ||
      (typeof value.tokenCiphertext === 'string' &&
        /^[A-Za-z0-9+/]+={0,2}$/.test(value.tokenCiphertext)))
  )
}

function toPublicService(service: StoredOmniRouteService): OmniRouteService {
  return {
    id: service.id,
    name: service.name,
    baseUrl: service.baseUrl,
    hasToken: Boolean(service.tokenCiphertext)
  }
}

function normalizeName(value: string): string | null {
  const name = value.trim()
  return name.length > 0 && name.length <= 80 && !containsControlCharacter(name) ? name : null
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x20 || code === 0x7f) {
      return true
    }
  }
  return false
}

function normalizeBaseUrl(value: string): string | null {
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      return null
    }
    return url.toString().replace(/\/+$/, '')
  } catch {
    return null
  }
}
