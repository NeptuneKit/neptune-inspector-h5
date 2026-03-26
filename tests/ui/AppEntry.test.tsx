// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppRouter } from '../../src/app/AppRouter'

function mockFetchClientsOnce() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        items: [
          {
            platform: 'ios',
            appId: 'com.demo.app',
            sessionId: 'session-1',
            deviceId: 'device-1',
            callbackEndpoint: 'http://127.0.0.1:18766/v2/client/command',
            preferredTransports: ['httpCallback'],
            lastSeenAt: '2026-03-25T00:00:00.000Z',
            expiresAt: '2026-03-25T00:02:00.000Z',
            ttlSeconds: 120,
            selected: false,
          },
        ],
      }),
    })),
  )
}

describe('App entry', () => {
  it('renders planned clients home page at root route', async () => {
    mockFetchClientsOnce()

    render(<AppRouter />)

    await waitFor(() => expect(screen.getByText('客户端列表')).toBeTruthy())
  })
})
