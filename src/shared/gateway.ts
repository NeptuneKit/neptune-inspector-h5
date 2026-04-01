import { normalizeBaseUrl } from '../api'

interface GatewayBaseUrlEnvironment {
  VITE_NEPTUNE_GATEWAY_URL?: string
  VITE_GATEWAY_URL?: string
}

function normalizeOptionalBaseUrl(input: string | null | undefined): string | null {
  if (input === null || input === undefined) {
    return null
  }
  const trimmed = input.trim()
  return trimmed.length > 0 ? normalizeBaseUrl(trimmed) : null
}

export function resolveGatewayBaseUrlFromEnv(
  env: GatewayBaseUrlEnvironment = import.meta.env as GatewayBaseUrlEnvironment,
): string | null {
  return normalizeOptionalBaseUrl(env.VITE_NEPTUNE_GATEWAY_URL) ?? normalizeOptionalBaseUrl(env.VITE_GATEWAY_URL)
}

export function resolveInitialBaseUrl(
  storedBaseUrl: string | null | undefined,
  fallbackBaseUrl: string,
  search: string = typeof window !== 'undefined' ? window.location.search : '',
  envBaseUrl: string | null = resolveGatewayBaseUrlFromEnv(),
): string {
  const gateway = new URLSearchParams(search).get('gateway')
  if (gateway && gateway.trim().length > 0) {
    return normalizeBaseUrl(gateway)
  }
  if (envBaseUrl && envBaseUrl.trim().length > 0) {
    return normalizeBaseUrl(envBaseUrl)
  }
  return normalizeBaseUrl(storedBaseUrl ?? fallbackBaseUrl)
}
