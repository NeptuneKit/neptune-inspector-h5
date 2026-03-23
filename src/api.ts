export function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) {
    return 'http://127.0.0.1:18765'
  }
  return trimmed.replace(/\/$/, '')
}
