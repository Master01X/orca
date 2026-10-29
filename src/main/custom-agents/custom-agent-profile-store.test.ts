import { afterEach, describe, expect, it } from 'vitest'
import { _resetSecretStoreForTests, setSecretStore } from '../../shared/secret-store'
import {
  CustomAgentProfileStore,
  type CustomAgentProfileStorage
} from './custom-agent-profile-store'

afterEach(() => {
  _resetSecretStoreForTests()
})

function makeStore(): {
  store: CustomAgentProfileStore
  files: Map<string, string>
} {
  const files = new Map<string, string>()
  const storage: CustomAgentProfileStorage = {
    exists: (path) => files.has(path),
    read: (path) => {
      const contents = files.get(path)
      if (contents === undefined) {
        throw new Error('Missing profile file')
      }
      return contents
    },
    harden: () => undefined,
    write: (path, contents) => {
      files.set(path, contents)
      return true
    }
  }
  return { store: new CustomAgentProfileStore('custom-agent-test', storage), files }
}

function installTestSecretStore(): void {
  setSecretStore({
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${value}`),
    decryptString: (value) => value.toString('utf8').replace(/^encrypted:/, ''),
    describeProtectionGap: () => null
  })
}

const claudeProfile = {
  version: 1,
  name: 'Claude staging',
  launcher: 'claude',
  protocol: 'anthropic',
  endpointUrl: 'https://api.example.test',
  model: 'claude-sonnet-4-20250514'
}

describe('CustomAgentProfileStore', () => {
  it('imports strict JSON and keeps API keys out of profile files', () => {
    installTestSecretStore()
    const { store, files } = makeStore()
    const profile = store.importJson(JSON.stringify(claudeProfile))[0]!
    expect(profile).toMatchObject({
      name: 'Claude staging',
      hasApiKey: false,
      isDefault: false
    })

    expect(() => store.importJson(JSON.stringify({ ...claudeProfile, apiKey: 'secret' }))).toThrow(
      /API keys belong in Settings/
    )
    expect(() =>
      store.importJson(JSON.stringify({ ...claudeProfile, endpointUrl: 'http://api.example.test' }))
    ).toThrow(/endpoint must be HTTPS/)

    const saved = store.save({
      id: profile.id,
      endpointUrl: profile.endpointUrl,
      model: profile.model,
      apiKey: 'provider-secret'
    })
    expect(saved[0]?.hasApiKey).toBe(true)
    expect([...files.values()].join('')).not.toContain('provider-secret')
  })

  it('uses the selected profile to route new Claude launches and rejects missing credentials', () => {
    installTestSecretStore()
    const { store } = makeStore()
    const profile = store.importJson(JSON.stringify(claudeProfile))[0]!
    expect(() => store.setDefault(profile.id)).toThrow(/Add an API key/)
    store.save({
      id: profile.id,
      endpointUrl: profile.endpointUrl,
      model: profile.model,
      apiKey: 'provider-secret'
    })
    store.setDefault(profile.id)

    expect(store.getLaunchProfile('claude')).toEqual({
      launcher: 'claude',
      protocol: 'anthropic',
      endpointUrl: 'https://api.example.test',
      model: 'claude-sonnet-4-20250514',
      apiKey: 'provider-secret'
    })
    expect(store.getLaunchProfile('claude-agent-teams')).toMatchObject({
      endpointUrl: 'https://api.example.test',
      model: 'claude-sonnet-4-20250514'
    })
    expect(store.getLaunchProfile('opencode')).toBeNull()
  })
})
