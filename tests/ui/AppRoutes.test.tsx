// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { AppRoutes } from '../../src/app/AppRoutes'

vi.mock('../../src/pages/ClientDetailPage', () => ({
  ClientDetailPage: () => <div>Client Detail Mock</div>,
}))

vi.mock('../../src/pages/ViewInfoPage', () => ({
  ViewInfoPage: () => <div>View Info Mock</div>,
}))

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

describe('app routes', () => {
  it('renders clients page and navigates to detail route', async () => {
    mockFetchClientsOnce()

    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByText('客户端列表')).toBeTruthy())
    fireEvent.click(screen.getByText('进入详情'))
    await waitFor(() => expect(screen.getByText('Client Detail Mock')).toBeTruthy())
  })

  it('renders view info route', async () => {
    render(
      <MemoryRouter initialEntries={['/clients/demo-client/views']}>
        <AppRoutes />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByText('View Info Mock')).toBeTruthy())
  })
})
