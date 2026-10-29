import { afterEach, describe, expect, it } from 'vitest'
import { _resetSecretStoreForTests, setSecretStore } from '../../shared/secret-store'
import { OMNIROUTE_DEFAULT_SERVICES } from '../../shared/omniroute-api'
import { OmniRouteClient } from './omniroute-client'
import { OmniRouteConfigStore, type OmniRouteConfigStorage } from './omniroute-config-store'

afterEach(() => {
  _resetSecretStoreForTests()
})

function makeStore(): {
  store: OmniRouteConfigStore
  files: Map<string, string>
} {
  const files = new Map<string, string>()
  const storage: OmniRouteConfigStorage = {
    exists: (path) => files.has(path),
    read: (path) => {
      const contents = files.get(path)
      if (contents === undefined) {
        throw new Error('Missing config')
      }
      return contents
    },
    harden: () => undefined,
    write: (path, contents) => {
      files.set(path, contents)
      return true
    }
  }
  return { store: new OmniRouteConfigStore('omniroute-test-user-data', storage), files }
}

function installTestSecretStore(): void {
  setSecretStore({
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${value}`),
    decryptString: (value) => value.toString('utf8').replace(/^encrypted:/, ''),
    describeProtectionGap: () => null
  })
}

describe('OmniRoute integration', () => {
  it('seeds the provided deployments and stores bearer tokens only as safeStorage ciphertext', () => {
    installTestSecretStore()
    const { store, files } = makeStore()
    expect(store.listServices()).toEqual(
      OMNIROUTE_DEFAULT_SERVICES.map((service) => ({ ...service, hasToken: false }))
    )

    const token = 'user-entered-bearer-secret'
    const services = store.saveService({
      id: OMNIROUTE_DEFAULT_SERVICES[0].id,
      name: 'Production',
      baseUrl: 'https://omniroute.example',
      bearerToken: token
    })
    const persisted = [...files.values()][0]
    expect(persisted).toBeDefined()
    expect(persisted).not.toContain(token)
    expect(services[0]).toMatchObject({ name: 'Production', hasToken: true })
    expect(store.getServiceForRequest(services[0].id)?.bearerToken).toBe(token)

    expect(store.clearBearerToken(services[0].id)[0].hasToken).toBe(false)
  })

  it('rejects insecure or credential-bearing base URLs without modifying saved services', () => {
    installTestSecretStore()
    const { store } = makeStore()
    const before = store.listServices()
    expect(() =>
      store.saveService({
        id: before[0].id,
        name: 'Changed',
        baseUrl: 'http://omniroute.example'
      })
    ).toThrow('valid HTTPS base URL')
    expect(() =>
      store.saveService({
        id: before[0].id,
        name: 'Changed',
        baseUrl: 'https://user:password@omniroute.example'
      })
    ).toThrow('valid HTTPS base URL')
    expect(store.listServices()).toEqual(before)
  })

  it('uses GET bearer requests and reports authentication failures without reflecting response bodies', async () => {
    installTestSecretStore()
    const { store } = makeStore()
    const first = store.listServices()[0]
    store.saveService({
      id: first.id,
      name: first.name,
      baseUrl: first.baseUrl,
      bearerToken: 'secret-token'
    })
    let fetchCount = 0
    const fetcher: typeof fetch = async (input: URL | RequestInfo, init?: RequestInit) => {
      fetchCount += 1
      expect(init?.method).toBe('GET')
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secret-token')
      expect(init?.redirect).toBe('error')
      return String(input).endsWith('/api/models/catalog')
        ? Response.json({ error: 'secret-token should not be reflected' }, { status: 401 })
        : Response.json({ status: 'healthy' })
    }
    const client = new OmniRouteClient(store, fetcher)

    const snapshot = await client.refreshService(first.id)

    expect(fetchCount).toBe(3)
    expect(snapshot.health).toMatchObject({ ok: true, statusCode: 200 })
    expect(snapshot.models).toMatchObject({
      ok: false,
      statusCode: 401,
      error: 'Unauthorized (401). Check the bearer token.'
    })
    expect(JSON.stringify(snapshot)).not.toContain('secret-token')
    expect(snapshot.requestBudget).toMatchObject({ limit: 60, remaining: 57 })
  })

  it('enforces a rolling 60-request cap per service before sending more requests', async () => {
    installTestSecretStore()
    const { store } = makeStore()
    const service = store.listServices()[0]
    let fetchCount = 0
    const fetcher: typeof fetch = async () => {
      fetchCount += 1
      return Response.json({ ok: true })
    }
    let now = 100_000
    const client = new OmniRouteClient(store, fetcher, () => now)

    for (let count = 0; count < 20; count += 1) {
      await client.refreshService(service.id)
    }
    const limited = await client.refreshService(service.id)

    expect(fetchCount).toBe(60)
    expect(limited.health).toMatchObject({
      ok: false,
      error: 'Local request limit reached. Wait for the one-minute window to reset.'
    })
    expect(limited.requestBudget.remaining).toBe(0)

    now += 60_001
    const recovered = await client.refreshService(service.id)
    expect(recovered.health.ok).toBe(true)
    expect(fetchCount).toBe(63)
  })

  it('does not replace a corrupt config file with default settings', () => {
    const { store, files } = makeStore()
    store.listServices()
    const [configPath] = files.keys()
    if (!configPath) {
      throw new Error('Config storage was not initialized.')
    }
    files.set(configPath, 'not valid json')

    expect(() => store.listServices()).toThrow('left unchanged')
    expect(files.get(configPath)).toBe('not valid json')
  })
})
