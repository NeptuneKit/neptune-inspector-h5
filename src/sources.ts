import { fetchJson, normalizeBaseUrl } from './api'
import { sourcesSchema } from './schemas'
import type { Source } from './types'

export function buildSourcesUrl(baseUrl: string): string {
  return new URL('/v2/sources', normalizeBaseUrl(baseUrl)).toString()
}

export async function fetchSources(baseUrl: string): Promise<Source[]> {
  return fetchJson(buildSourcesUrl(baseUrl), sourcesSchema, 'sources')
}

export function sortSources(sources: Source[]): Source[] {
  return [...sources].sort((left, right) => {
    const seenCompare = right.lastSeenAt.localeCompare(left.lastSeenAt)
    if (seenCompare !== 0) {
      return seenCompare
    }

    const platformCompare = left.platform.localeCompare(right.platform)
    if (platformCompare !== 0) {
      return platformCompare
    }

    const appCompare = left.appId.localeCompare(right.appId)
    if (appCompare !== 0) {
      return appCompare
    }

    const sessionCompare = left.sessionId.localeCompare(right.sessionId)
    if (sessionCompare !== 0) {
      return sessionCompare
    }

    return left.deviceId.localeCompare(right.deviceId)
  })
}
