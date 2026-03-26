// @vitest-environment jsdom
import { act, render, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ClientDetailPage } from '../../src/pages/ClientDetailPage'
import { encodeClientKey, type ClientIdentity } from '../../src/features/clients/clientKey'
import type { LogRecord } from '../../src/types'

const { fetchClientLogsMock, useInspectorLogStreamMock } = vi.hoisted(() => ({
  fetchClientLogsMock: vi.fn(),
  useInspectorLogStreamMock: vi.fn(),
}))

vi.mock('../../src/features/logs/logService', async () => {
  const actual = await vi.importActual<typeof import('../../src/features/logs/logService')>('../../src/features/logs/logService')
  return {
    ...actual,
    fetchClientLogs: fetchClientLogsMock,
  }
})

vi.mock('../../src/features/ws/useInspectorLogStream', () => ({
  useInspectorLogStream: useInspectorLogStreamMock,
}))

describe('ClientDetailPage', () => {
  it('uses websocket notify to trigger one incremental http fetch', async () => {
    fetchClientLogsMock.mockReset()
    useInspectorLogStreamMock.mockReset()

    const identity: ClientIdentity = {
      platform: 'ios',
      appId: 'com.neptunekit.demo.ios',
      sessionId: 'simulator-session',
      deviceId: '0A9C614E-1DC9-4B0F-AB80-11448EAE708E',
    }
    const clientKey = encodeClientKey(identity)

    fetchClientLogsMock
      .mockResolvedValueOnce([sampleRecord(100, identity)])
      .mockResolvedValueOnce([sampleRecord(101, identity)])

    let wsOptions:
      | {
          onRecord: (record: LogRecord) => void
          onStatusChange: (snapshot: { connected: boolean; status: string }) => void
        }
      | undefined
    useInspectorLogStreamMock.mockImplementation((options) => {
      wsOptions = options
    })

    render(
      <MemoryRouter initialEntries={[`/clients/${clientKey}`]}>
        <Routes>
          <Route path="/clients/:clientKey" element={<ClientDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => expect(fetchClientLogsMock).toHaveBeenCalledTimes(1))
    expect(fetchClientLogsMock.mock.calls[0]?.[2]).toEqual({ waitMs: 0, limit: 200 })

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fetchClientLogsMock).toHaveBeenCalledTimes(1)

    expect(wsOptions).toBeDefined()
    if (!wsOptions) {
      return
    }

    await act(async () => {
      wsOptions?.onRecord(sampleRecord(101, identity))
      await Promise.resolve()
    })

    await waitFor(() => expect(fetchClientLogsMock).toHaveBeenCalledTimes(2))
    expect(fetchClientLogsMock.mock.calls[1]?.[2]).toEqual({ afterId: '100', waitMs: 0, limit: 200 })
  })

  it('renders readable compact metadata tags for each log record', async () => {
    fetchClientLogsMock.mockReset()
    useInspectorLogStreamMock.mockReset()

    const identity: ClientIdentity = {
      platform: 'ios',
      appId: 'com.neptunekit.demo.ios',
      sessionId: 'simulator-session',
      deviceId: '0A9C614E-1DC9-4B0F-AB80-11448EAE708E',
    }
    const clientKey = encodeClientKey(identity)

    fetchClientLogsMock.mockResolvedValueOnce([sampleRecord(100, identity)])
    useInspectorLogStreamMock.mockImplementation(() => {})

    const { container } = render(
      <MemoryRouter initialEntries={[`/clients/${clientKey}`]}>
        <Routes>
          <Route path="/clients/:clientKey" element={<ClientDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => expect(fetchClientLogsMock).toHaveBeenCalledTimes(1))
    const recordTags = container.querySelector('.record-tags')
    expect(recordTags).toBeTruthy()
  })
})

function sampleRecord(id: number, identity: ClientIdentity): LogRecord {
  return {
    id,
    timestamp: '2026-03-25T10:00:00.000Z',
    level: 'info',
    message: `msg-${id}`,
    platform: identity.platform,
    appId: identity.appId,
    sessionId: identity.sessionId,
    deviceId: identity.deviceId,
    category: 'default',
  }
}
