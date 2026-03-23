import type { ZodType } from 'zod'

export function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) {
    return 'http://127.0.0.1:18765'
  }
  return trimmed.replace(/\/$/, '')
}

export async function fetchJson<T>(url: string, schema: ZodType<T>, errorLabel: string): Promise<T> {
  const response = await fetch(url)
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
