import {
  OMNIROUTE_LOCAL_REQUEST_LIMIT,
  OMNIROUTE_REQUEST_WINDOW_MS,
  type OmniRouteEndpointResult,
  type OmniRouteRequestBudget,
  type OmniRouteSnapshot
} from '../../shared/omniroute-api'
import type { OmniRouteConfigStore } from './omniroute-config-store'

const MAX_RESPONSE_BYTES = 1_000_000
const REQUEST_TIMEOUT_MS = 10_000
const ENDPOINTS = {
  health: '/api/monitoring/health',
  models: '/api/models/catalog',
  rateLimits: '/api/rate-limits'
} as const

type Fetcher = typeof fetch

export class OmniRouteClient {
  private readonly requestTimesByService = new Map<string, number[]>()

  constructor(
    private readonly store: OmniRouteConfigStore,
    private readonly fetcher: Fetcher = fetch,
    private readonly now: () => number = Date.now
  ) {}

  getServices() {
    return this.store.listServices()
  }

  saveService(draft: Parameters<OmniRouteConfigStore['saveService']>[0]) {
    return this.store.saveService(draft)
  }

  clearBearerToken(id: string) {
    return this.store.clearBearerToken(id)
  }

  removeService(id: string) {
    return this.store.removeService(id)
  }

  async refreshService(id: string): Promise<OmniRouteSnapshot> {
    const service = this.store.getServiceForRequest(id)
    if (!service) {
      throw new Error('This OmniRoute service no longer exists.')
    }

    const authBlocked = Boolean(service.credentialError)
    const requestCount = authBlocked ? 1 : Object.keys(ENDPOINTS).length
    const reservation = this.reserveRequests(service.baseUrl, requestCount)
    const budget = this.getRequestBudget(service.baseUrl)
    if (!reservation) {
      const error = 'Local request limit reached. Wait for the one-minute window to reset.'
      return {
        serviceId: id,
        health: { ok: false, error },
        models: { ok: false, error },
        rateLimits: { ok: false, error },
        requestBudget: budget
      }
    }

    const [health, models, rateLimits] = await Promise.all([
      this.getEndpoint(service.baseUrl, ENDPOINTS.health, service.bearerToken),
      authBlocked
        ? failedEndpoint(service.credentialError ?? 'Saved bearer token is unavailable.')
        : this.getEndpoint(service.baseUrl, ENDPOINTS.models, service.bearerToken),
      authBlocked
        ? failedEndpoint(service.credentialError ?? 'Saved bearer token is unavailable.')
        : this.getEndpoint(service.baseUrl, ENDPOINTS.rateLimits, service.bearerToken)
    ])

    return {
      serviceId: id,
      health,
      models,
      rateLimits,
      requestBudget: this.getRequestBudget(service.baseUrl)
    }
  }

  private async getEndpoint(
    baseUrl: string,
    path: string,
    bearerToken: string | null
  ): Promise<OmniRouteEndpointResult> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await this.fetcher(new URL(path, `${baseUrl}/`), {
        method: 'GET',
        redirect: 'error',
        cache: 'no-store',
        credentials: 'omit',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {})
        }
      })
      if (!response.ok) {
        const statusCode = response.status
        const error =
          statusCode === 401
            ? 'Unauthorized (401). Check the bearer token.'
            : statusCode === 403
              ? 'Access denied (403). Check the token permissions.'
              : statusCode === 429
                ? 'The service rate limit was reached (429).'
                : `The service returned HTTP ${statusCode}.`
        return { ok: false, error, statusCode }
      }
      return {
        ok: true,
        statusCode: response.status,
        data: await readJsonResponse(response)
      }
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error && error.name === 'AbortError'
            ? 'Request timed out.'
            : 'Could not reach the service or read its response.'
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  private reserveRequests(serviceKey: string, count: number): boolean {
    const now = this.now()
    const windowStart = now - OMNIROUTE_REQUEST_WINDOW_MS
    const times = (this.requestTimesByService.get(serviceKey) ?? []).filter(
      (time) => time > windowStart
    )
    if (times.length + count > OMNIROUTE_LOCAL_REQUEST_LIMIT) {
      this.requestTimesByService.set(serviceKey, times)
      return false
    }
    for (let index = 0; index < count; index += 1) {
      times.push(now)
    }
    this.requestTimesByService.set(serviceKey, times)
    return true
  }

  private getRequestBudget(serviceKey: string): OmniRouteRequestBudget {
    const now = this.now()
    const times = (this.requestTimesByService.get(serviceKey) ?? []).filter(
      (time) => time > now - OMNIROUTE_REQUEST_WINDOW_MS
    )
    this.requestTimesByService.set(serviceKey, times)
    return {
      limit: OMNIROUTE_LOCAL_REQUEST_LIMIT,
      remaining: Math.max(0, OMNIROUTE_LOCAL_REQUEST_LIMIT - times.length),
      resetsAt: times.length > 0 ? times[0] + OMNIROUTE_REQUEST_WINDOW_MS : null
    }
  }
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error('Response too large')
  }
  if (!response.body) {
    return null
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) {
        break
      }
      length += result.value.byteLength
      if (length > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new Error('Response too large')
      }
      chunks.push(result.value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
    return parsed
  } catch {
    throw new Error('Invalid JSON response')
  }
}

function failedEndpoint(error: string): OmniRouteEndpointResult {
  return { ok: false, error }
}
