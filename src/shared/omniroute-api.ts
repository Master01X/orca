export const OMNIROUTE_LOCAL_REQUEST_LIMIT = 60
export const OMNIROUTE_REQUEST_WINDOW_MS = 60_000

export const OMNIROUTE_DEFAULT_SERVICES = [
  {
    id: 'ominiroute-production',
    name: 'OmniRoute Production',
    baseUrl: 'https://ominiroute-production.up.railway.app'
  },
  {
    id: 'omniroute-workspaces-production',
    name: 'OmniRoute Workspaces',
    baseUrl: 'https://omniroute-workspaces-production.up.railway.app'
  },
  {
    id: 'omniroute-workspaces3-production',
    name: 'OmniRoute Workspaces 3',
    baseUrl: 'https://omniroute-workspaces3-production.up.railway.app'
  }
] as const

export type OmniRouteService = {
  id: string
  name: string
  baseUrl: string
  hasToken: boolean
}

export type OmniRouteServiceDraft = {
  id?: string
  name: string
  baseUrl: string
  bearerToken?: string
}

export type OmniRouteEndpointResult =
  | { ok: true; statusCode: number; data: unknown }
  | { ok: false; error: string; statusCode?: number }

export type OmniRouteRequestBudget = {
  limit: number
  remaining: number
  resetsAt: number | null
}

export type OmniRouteSnapshot = {
  serviceId: string
  health: OmniRouteEndpointResult
  models: OmniRouteEndpointResult
  rateLimits: OmniRouteEndpointResult
  requestBudget: OmniRouteRequestBudget
}

export type OmniRouteOperationResult =
  | { ok: true; services: OmniRouteService[] }
  | { ok: false; error: string }

export type OmniRouteApi = {
  getServices: () => Promise<OmniRouteOperationResult>
  saveService: (draft: OmniRouteServiceDraft) => Promise<OmniRouteOperationResult>
  clearBearerToken: (args: { id: string }) => Promise<OmniRouteOperationResult>
  removeService: (args: { id: string }) => Promise<OmniRouteOperationResult>
  refreshService: (args: { id: string }) => Promise<OmniRouteSnapshot>
}
