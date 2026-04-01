import type { ZodType } from 'zod'

export function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) {
    return 'http://127.0.0.1:18765'
  }
  return trimmed.replace(/\/$/, '')
}

async function readErrorReason(response: Response): Promise<string | null> {
  try {
    const payload = await response.json() as { reason?: unknown; message?: unknown }
    if (typeof payload.reason === 'string' && payload.reason.trim().length > 0) {
      return payload.reason.trim()
    }
    if (typeof payload.message === 'string' && payload.message.trim().length > 0) {
      return payload.message.trim()
    }
  } catch {
    // ignore non-json or empty body
  }
  return null
}

function buildHttpErrorMessage(pathname: string, status: number, reason: string | null): string {
  if (pathname === '/v2/ui-tree/snapshot' && status === 404) {
    const normalizedReason = reason?.toLowerCase() ?? ''
    const looksLikeOffline =
      normalizedReason.includes('offline') ||
      normalizedReason.includes('no available ui-tree snapshot') ||
      normalizedReason.includes('no live ui-tree snapshot')
    if (looksLikeOffline) {
      return '当前客户端离线或未上报实时 UI 树快照，请先连接设备并触发页面刷新后重试。'
    }
  }
  if (reason && reason.length > 0) {
    return `GET ${pathname} failed with HTTP ${String(status)}: ${reason}`
  }
  return `GET ${pathname} failed with HTTP ${String(status)}`
}

export async function fetchJson<T>(url: string, schema: ZodType<T>, errorLabel: string): Promise<T> {
  const resolvedUrl = new URL(url).toString()
  const pathname = new URL(url).pathname
  let response: Response
  try {
    response = await fetch(resolvedUrl)
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(`Failed to fetch ${pathname}. 请检查网关地址是否可达，或确认是否存在跨域限制。`)
    }
    throw error
  }
  if (!response.ok) {
    const reason = await readErrorReason(response)
    throw new Error(buildHttpErrorMessage(pathname, response.status, reason))
  }

  const payload = await response.json()
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const detail = issue ? `${issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''}${issue.message}` : 'unknown schema mismatch'
    throw new Error(`Invalid ${errorLabel} payload from ${pathname}: ${detail}`)
  }

  return parsed.data
}
