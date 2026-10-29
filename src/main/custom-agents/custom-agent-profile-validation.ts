import { z } from 'zod'
import type {
  CustomAgentProfile,
  CustomAgentProfileDefinition
} from '../../shared/custom-agent-profiles'

export type StoredProfile = CustomAgentProfileDefinition & {
  id: string
  apiKeyCiphertext?: string
  isDefault: boolean
}

export type StoredConfig = {
  version: 1
  profiles: StoredProfile[]
}

const definitionSchema = z
  .object({
    version: z.literal(1),
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(500).optional(),
    launcher: z.enum(['claude', 'codex']),
    protocol: z.enum(['anthropic', 'openai-compatible']),
    endpointUrl: z.string().trim().min(1).max(2048),
    model: z.string().trim().min(1).max(200)
  })
  .strict()

export function normalizeEndpointUrl(value: string): string | null {
  try {
    const url = new URL(value.trim())
    const localHttp =
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase())
    if (
      (url.protocol !== 'https:' && !localHttp) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null
    }
    return url.toString().replace(/\/+$/, '')
  } catch {
    return null
  }
}

export function normalizeModel(value: string): string | null {
  const model = value.trim()
  return model.length > 0 && model.length <= 200 && /^[A-Za-z0-9._:/@+-]+$/.test(model)
    ? model
    : null
}

export function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x20 || code === 0x7f) {
      return true
    }
  }
  return false
}

export function parseDefinition(value: unknown): CustomAgentProfileDefinition {
  const parsed = definitionSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error(
      'Invalid agent profile. Expected version, name, launcher (claude or codex), protocol, endpointUrl and model; API keys belong in Settings.'
    )
  }
  const endpointUrl = normalizeEndpointUrl(parsed.data.endpointUrl)
  const model = normalizeModel(parsed.data.model)
  if (!endpointUrl || !model) {
    throw new Error('Profile endpoint must be HTTPS (or localhost HTTP) and model must be valid.')
  }
  if (
    (parsed.data.launcher === 'claude' && parsed.data.protocol !== 'anthropic') ||
    (parsed.data.launcher === 'codex' && parsed.data.protocol !== 'openai-compatible')
  ) {
    throw new Error(
      'Claude profiles require the Anthropic protocol; Codex profiles require OpenAI-compatible.'
    )
  }
  return {
    ...parsed.data,
    endpointUrl,
    model,
    ...(parsed.data.description ? { description: parsed.data.description } : {})
  }
}

export function isStoredConfig(value: unknown): value is StoredConfig {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !Array.isArray(value.profiles) ||
    value.profiles.length > 100
  ) {
    return false
  }
  return value.profiles.every(isStoredProfile)
}

function isStoredProfile(value: unknown): value is StoredProfile {
  if (!isRecord(value) || typeof value.id !== 'string' || !/^[\w.-]{1,128}$/.test(value.id)) {
    return false
  }
  const definition = definitionSchema.safeParse({
    version: value.version,
    name: value.name,
    description: value.description,
    launcher: value.launcher,
    protocol: value.protocol,
    endpointUrl: value.endpointUrl,
    model: value.model
  })
  return (
    definition.success &&
    ((value.launcher === 'claude' && value.protocol === 'anthropic') ||
      (value.launcher === 'codex' && value.protocol === 'openai-compatible')) &&
    typeof value.endpointUrl === 'string' &&
    normalizeEndpointUrl(value.endpointUrl) === value.endpointUrl &&
    typeof value.model === 'string' &&
    normalizeModel(value.model) === value.model &&
    typeof value.isDefault === 'boolean' &&
    (value.apiKeyCiphertext === undefined ||
      (typeof value.apiKeyCiphertext === 'string' &&
        /^[A-Za-z0-9+/]+={0,2}$/.test(value.apiKeyCiphertext)))
  )
}

export function toPublicProfile(profile: StoredProfile): CustomAgentProfile {
  const { apiKeyCiphertext, ...metadata } = profile
  return { ...metadata, hasApiKey: Boolean(apiKeyCiphertext) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
