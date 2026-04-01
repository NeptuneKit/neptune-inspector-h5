import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildInspectorSnapshotUrl,
  buildViewSnapshotUrl,
  fetchInspectorSnapshot,
  fetchViewSnapshot,
} from '../src/features/views/viewService'
import type { ClientIdentity } from '../src/features/clients/clientKey'

afterEach(() => {
  vi.unstubAllGlobals()
})

const identity: ClientIdentity = {
  platform: 'ios',
  appId: 'com.demo.app',
  sessionId: 'session-1',
  deviceId: 'device-1',
}

describe('view service', () => {
  it('builds the view snapshot endpoint url', () => {
    expect(buildViewSnapshotUrl('http://127.0.0.1:18765/', identity))
      .toBe('http://127.0.0.1:18765/v2/ui-tree/snapshot?platform=ios&appId=com.demo.app&sessionId=session-1&deviceId=device-1')
  })

  it('fetches view snapshot payload', async () => {
    const payload = {
      snapshotId: 'snap-1',
      capturedAt: '2026-03-26T11:11:11.000Z',
      platform: 'ios',
      roots: [
        {
          id: 'root',
          parentId: null,
          name: 'UIWindow',
          children: [],
        },
      ],
    }
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => payload })
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchViewSnapshot('http://127.0.0.1:18765', identity)).resolves.toEqual(payload)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:18765/v2/ui-tree/snapshot?platform=ios&appId=com.demo.app&sessionId=session-1&deviceId=device-1',
    )
  })

  it('builds the inspector snapshot endpoint url using only deviceId', () => {
    expect(buildInspectorSnapshotUrl('http://127.0.0.1:18765/', identity))
      .toBe('http://127.0.0.1:18765/v2/ui-tree/inspector?deviceId=device-1')
  })

  it('fetches inspector snapshot payload', async () => {
    const payload = {
      snapshotId: 'inspector-1',
      capturedAt: '2026-03-26T11:11:11.000Z',
      platform: 'ios',
      available: true,
      payload: { $type: 'root' },
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => payload }))

    await expect(fetchInspectorSnapshot('http://127.0.0.1:18765', identity)).resolves.toEqual(payload)
  })

  it('maps offline snapshot 404 into actionable message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({
        error: true,
        reason: 'Requested client is offline; no live ui-tree snapshot available.',
      }),
    }))

    await expect(fetchViewSnapshot('http://127.0.0.1:18765', identity))
      .rejects
      .toThrow('当前客户端离线或未上报实时 UI 树快照，请先连接设备并触发页面刷新后重试。')
  })
})
