// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useInspectorLogStream } from '../src/features/ws/useInspectorLogStream'
import type { ClientIdentity } from '../src/features/clients/clientKey'
import type { LogRecord } from '../src/types'

const { createInspectorWsClientMock } = vi.hoisted(() => ({
  createInspectorWsClientMock: vi.fn(),
}))

vi.mock('../src/ws', () => ({
  createInspectorWsClient: createInspectorWsClientMock,
}))

type ConnectionSnapshot = { connected: boolean; status: string }

function HookHarness(props: {
  baseUrl: string
  identity: ClientIdentity | null
  onRecord: (record: LogRecord) => void
  onStatusChange: (snapshot: ConnectionSnapshot) => void
}) {
  useInspectorLogStream(props)
  return null
}

describe('useInspectorLogStream', () => {
  beforeEach(() => {
    createInspectorWsClientMock.mockReset()
  })

  it('does not recreate ws client when only callback references change', () => {
    const client = { start: vi.fn(), stop: vi.fn() }
    createInspectorWsClientMock.mockReturnValue(client)

    const identity: ClientIdentity = {
      platform: 'ios',
      appId: 'com.neptunekit.demo.ios',
      sessionId: 'simulator-session',
      deviceId: 'device-1',
    }

    const firstOnRecord = vi.fn()
    const firstOnStatus = vi.fn()
    const view = render(
      <HookHarness
        baseUrl="http://127.0.0.1:18765"
        identity={identity}
        onRecord={firstOnRecord}
        onStatusChange={firstOnStatus}
      />,
    )

    const secondOnRecord = vi.fn()
    const secondOnStatus = vi.fn()
    view.rerender(
      <HookHarness
        baseUrl="http://127.0.0.1:18765"
        identity={identity}
        onRecord={secondOnRecord}
        onStatusChange={secondOnStatus}
      />,
    )

    expect(createInspectorWsClientMock).toHaveBeenCalledTimes(1)
    expect(client.start).toHaveBeenCalledTimes(1)
    expect(client.stop).toHaveBeenCalledTimes(0)

    view.unmount()
    expect(client.stop).toHaveBeenCalledTimes(1)
  })

  it('dispatches websocket events to latest callbacks without reconnecting', () => {
    const client = { start: vi.fn(), stop: vi.fn() }
    createInspectorWsClientMock.mockReturnValue(client)

    const identity: ClientIdentity = {
      platform: 'ios',
      appId: 'com.neptunekit.demo.ios',
      sessionId: 'simulator-session',
      deviceId: 'device-1',
    }

    const firstOnRecord = vi.fn()
    const firstOnStatus = vi.fn()

    const view = render(
      <HookHarness
        baseUrl="http://127.0.0.1:18765"
        identity={identity}
        onRecord={firstOnRecord}
        onStatusChange={firstOnStatus}
      />,
    )

    const wsOptions = createInspectorWsClientMock.mock.calls[0]?.[0] as
      | {
          onLogRecord: (record: LogRecord) => void
          onConnectionChange: (snapshot: ConnectionSnapshot) => void
        }
      | undefined

    expect(wsOptions).toBeDefined()
    if (!wsOptions) {
      view.unmount()
      return
    }

    wsOptions.onLogRecord(sampleRecord(1))
    wsOptions.onConnectionChange({ connected: true, status: 'connected' })
    expect(firstOnRecord).toHaveBeenCalledTimes(1)
    expect(firstOnStatus).toHaveBeenCalledTimes(1)

    const secondOnRecord = vi.fn()
    const secondOnStatus = vi.fn()
    view.rerender(
      <HookHarness
        baseUrl="http://127.0.0.1:18765"
        identity={identity}
        onRecord={secondOnRecord}
        onStatusChange={secondOnStatus}
      />,
    )

    wsOptions.onLogRecord(sampleRecord(2))
    wsOptions.onConnectionChange({ connected: false, status: 'reconnecting' })

    expect(createInspectorWsClientMock).toHaveBeenCalledTimes(1)
    expect(firstOnRecord).toHaveBeenCalledTimes(1)
    expect(firstOnStatus).toHaveBeenCalledTimes(1)
    expect(secondOnRecord).toHaveBeenCalledTimes(1)
    expect(secondOnStatus).toHaveBeenCalledTimes(1)

    view.unmount()
  })
})

function sampleRecord(id: number): LogRecord {
  return {
    id,
    timestamp: '2026-03-25T00:00:00.000Z',
    level: 'info',
    message: `message-${id}`,
    platform: 'ios',
    appId: 'com.neptunekit.demo.ios',
    sessionId: 'simulator-session',
    deviceId: 'device-1',
    category: 'default',
  }
}
