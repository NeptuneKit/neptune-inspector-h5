import { fetchJson, normalizeBaseUrl } from '../../api'
import { inspectorSnapshotSchema, viewTreeSnapshotSchema } from '../../schemas'
import type { InspectorSnapshot, ViewTreeSnapshot } from '../../types'
import type { ClientIdentity } from '../clients/clientKey'

export type MockPlatform = 'harmony' | 'ios' | 'android'
export interface ViewSnapshotOptions {
  refresh?: boolean
}

const MOCK_TREE_SNAPSHOT_PATHS: Record<MockPlatform, string> = {
  harmony: '/mocks/tree-snapshot.harmony.json',
  ios: '/mocks/tree-snapshot.ios.json',
  android: '/mocks/tree-snapshot.android.json',
}

export function buildViewSnapshotUrl(
  baseUrl: string,
  identity: ClientIdentity,
  options: ViewSnapshotOptions = {},
): string {
  const url = new URL('/v2/ui-tree/snapshot', normalizeBaseUrl(baseUrl))
  url.searchParams.set('platform', identity.platform)
  url.searchParams.set('appId', identity.appId)
  url.searchParams.set('sessionId', identity.sessionId)
  url.searchParams.set('deviceId', identity.deviceId)
  if (options.refresh === true) {
    url.searchParams.set('refresh', '1')
  }
  return url.toString()
}

export async function fetchViewSnapshot(
  baseUrl: string,
  identity: ClientIdentity,
  options: ViewSnapshotOptions = {},
): Promise<ViewTreeSnapshot> {
  return fetchJson(buildViewSnapshotUrl(baseUrl, identity, options), viewTreeSnapshotSchema, 'view tree snapshot')
}

export async function fetchMockViewSnapshot(platform: MockPlatform = 'harmony'): Promise<ViewTreeSnapshot> {
  const path = MOCK_TREE_SNAPSHOT_PATHS[platform] ?? MOCK_TREE_SNAPSHOT_PATHS.harmony
  const url = new URL(path, window.location.origin).toString()
  return fetchJson(url, viewTreeSnapshotSchema, 'mock tree snapshot')
}

export function buildInspectorSnapshotUrl(baseUrl: string, identity: Pick<ClientIdentity, 'deviceId'>): string {
  const url = new URL('/v2/ui-tree/inspector', normalizeBaseUrl(baseUrl))
  url.searchParams.set('deviceId', identity.deviceId)
  return url.toString()
}

export async function fetchInspectorSnapshot(
  baseUrl: string,
  identity: Pick<ClientIdentity, 'deviceId'>,
): Promise<InspectorSnapshot> {
  return fetchJson(buildInspectorSnapshotUrl(baseUrl, identity), inspectorSnapshotSchema, 'inspector snapshot')
}
