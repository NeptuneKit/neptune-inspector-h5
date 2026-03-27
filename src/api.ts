import type { ZodType } from 'zod'

const DEV_GATEWAY_PROXY_PREFIX = '/__neptune_gateway'

export function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) {
    return 'http://127.0.0.1:18765'
  }
  return trimmed.replace(/\/$/, '')
}

function shouldUseDevProxy(url: URL): boolean {
  if (typeof window === 'undefined') {
    return false
  }
  const isViteDevPort = window.location.port === '5188'
  const isLocalGateway = (url.hostname === '127.0.0.1' || url.hostname === 'localhost') && url.port === '18765'
  return isViteDevPort && isLocalGateway
}

function resolveRequestUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl)
  if (!shouldUseDevProxy(parsed)) {
    return parsed.toString()
  }
  return `${DEV_GATEWAY_PROXY_PREFIX}${parsed.pathname}${parsed.search}`
}

export async function fetchJson<T>(url: string, schema: ZodType<T>, errorLabel: string): Promise<T> {
  const resolvedUrl = resolveRequestUrl(url)
  let response: Response
  try {
    response = await fetch(resolvedUrl)
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(`Failed to fetch ${new URL(url).pathname}. 请检查网关地址是否可达，或确认是否存在跨域限制。`)
    }
    throw error
  }
  if (!response.ok) {
    throw new Error(`GET ${new URL(url).pathname} failed with HTTP ${response.status}`)
  }

  const payload = await response.json()
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const detail = issue ? `${issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''}${issue.message}` : 'unknown schema mismatch'
    throw new Error(`Invalid ${errorLabel} payload from ${new URL(url).pathname}: ${detail}`)
  }

  return parsed.data
}
