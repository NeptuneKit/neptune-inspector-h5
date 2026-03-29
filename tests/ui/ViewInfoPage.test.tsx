// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ViewInfoPage } from '../../src/pages/ViewInfoPage'
import { encodeClientKey, type ClientIdentity } from '../../src/features/clients/clientKey'

const { fetchViewSnapshotMock, fetchMockViewSnapshotMock } = vi.hoisted(() => ({
  fetchViewSnapshotMock: vi.fn(),
  fetchMockViewSnapshotMock: vi.fn(),
}))

vi.mock('../../src/features/views/viewService', () => ({
  fetchViewSnapshot: fetchViewSnapshotMock,
  fetchMockViewSnapshot: fetchMockViewSnapshotMock,
}))

afterEach(() => cleanup())

describe('ViewInfoPage', () => {
  it('renders view tree snapshot', async () => {
    fetchViewSnapshotMock.mockReset()
    fetchMockViewSnapshotMock.mockReset()

    const identity: ClientIdentity = {
      platform: 'harmony',
      appId: 'com.demo.harmony',
      sessionId: 'session-1',
      deviceId: 'device-1',
    }
    const clientKey = encodeClientKey(identity)

    fetchViewSnapshotMock.mockResolvedValue({
      snapshotId: 'snap-1',
      capturedAt: '2026-03-26T12:00:00.000Z',
      platform: 'harmony',
      roots: [
        {
          id: 'root',
          parentId: null,
          name: 'root',
          frame: { x: 0, y: 0, width: 320, height: 640 },
          children: [
            {
              id: 'child-1',
              parentId: 'root',
              name: 'Text',
              frame: { x: 12, y: 24, width: 120, height: 24 },
              style: {
                typographyUnit: 'dp',
                sourceTypographyUnit: 'fp',
                platformFontScale: 1.15,
                fontSize: 14,
                lineHeight: 18,
                letterSpacing: 0.2,
                fontWeight: '600',
                fontWeightRaw: 'FontWeight.Medium',
              },
              text: 'Hello',
              children: [],
            },
          ],
        },
      ],
    })

    render(
      <MemoryRouter initialEntries={[`/clients/${clientKey}/views`]}>
        <Routes>
          <Route path="/clients/:clientKey/views" element={<ViewInfoPage />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => expect(fetchViewSnapshotMock).toHaveBeenCalledTimes(1))
    expect(fetchViewSnapshotMock).toHaveBeenCalledWith('http://127.0.0.1:18765', identity, { refresh: false })
    expect(fetchMockViewSnapshotMock).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByText('View Info')).toBeTruthy())
    expect(screen.getAllByText('root').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Text').length).toBeGreaterThan(0)
    expect(screen.getByText('Hello')).toBeTruthy()
    expect(screen.getByText('Snapshot: snap-1')).toBeTruthy()
    expect(screen.getByTestId('view-canvas-2d')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Show Connections' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Show Connections' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show Connections' }))
    fireEvent.click(screen.getAllByText('Text')[0])
    expect(screen.getByText('Typography')).toBeTruthy()
    expect(screen.getByText('Source Unit')).toBeTruthy()
    expect(screen.getByText('fp')).toBeTruthy()
    expect(screen.getByText('Weight Raw')).toBeTruthy()
    expect(screen.getByText('FontWeight.Medium')).toBeTruthy()
    expect(screen.getByText('Canonical Weight')).toBeTruthy()
    expect(screen.getAllByText('600').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: '3D' }))
    expect(screen.getByTestId('view-canvas-3d')).toBeTruthy()
  })

  it('shows error for invalid client key', async () => {
    fetchViewSnapshotMock.mockReset()
    fetchMockViewSnapshotMock.mockReset()

    render(
      <MemoryRouter initialEntries={['/clients/invalid/views']}>
        <Routes>
          <Route path="/clients/:clientKey/views" element={<ViewInfoPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText('Invalid client identity, cannot view info.')).toBeTruthy()
    expect(fetchViewSnapshotMock).not.toHaveBeenCalled()
    expect(fetchMockViewSnapshotMock).not.toHaveBeenCalled()
  })

  it('renders replay mode without inspector chrome', async () => {
    fetchViewSnapshotMock.mockReset()
    fetchMockViewSnapshotMock.mockReset()

    fetchMockViewSnapshotMock.mockResolvedValue({
      snapshotId: 'snap-replay',
      capturedAt: '2026-03-27T12:00:00.000Z',
      platform: 'ios',
      roots: [
        {
          id: 'window',
          parentId: null,
          name: 'UIWindow',
          frame: { x: 0, y: 0, width: 390, height: 844 },
          children: [
            {
              id: 'title',
              parentId: 'window',
              name: 'UILabel',
              frame: { x: 20, y: 120, width: 240, height: 38 },
              style: {
                typographyUnit: 'dp',
                sourceTypographyUnit: 'pt',
                platformFontScale: 1,
                fontSize: 34,
                lineHeight: 41,
                letterSpacing: 0,
                fontWeight: '700',
              },
              text: 'Neptune SDK iOS Demo',
              children: [],
            },
          ],
        },
      ],
    })

    render(
      <MemoryRouter initialEntries={['/mock-views?platform=ios&replay=1']}>
        <Routes>
          <Route path="/mock-views" element={<ViewInfoPage mockOnly mockPlatform="ios" replayMode />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => expect(fetchMockViewSnapshotMock).toHaveBeenCalledTimes(1))
    expect(fetchMockViewSnapshotMock).toHaveBeenCalledWith('ios')
    expect(screen.queryByText('View Info')).toBeNull()
    expect(screen.queryByText('View Inspector')).toBeNull()
    expect(screen.getByTestId('replay-device-frame')).toBeTruthy()
    expect(screen.getByTestId('view-canvas-2d')).toBeTruthy()
    expect(screen.getByText('Neptune SDK iOS Demo')).toBeTruthy()
  })

  it('renders replay capture mode without toolbar and extra padding', async () => {
    fetchViewSnapshotMock.mockReset()
    fetchMockViewSnapshotMock.mockReset()

    fetchMockViewSnapshotMock.mockResolvedValue({
      snapshotId: 'snap-capture',
      capturedAt: '2026-03-27T12:00:00.000Z',
      platform: 'ios',
      roots: [
        {
          id: 'window',
          parentId: null,
          name: 'UIWindow',
          frame: { x: 0, y: 0, width: 390, height: 844 },
          children: [
            {
              id: 'title',
              parentId: 'window',
              name: 'UILabel',
              frame: { x: 20, y: 120, width: 240, height: 38 },
              style: {
                typographyUnit: 'dp',
                sourceTypographyUnit: 'pt',
                platformFontScale: 1,
                fontSize: 34,
                lineHeight: 41,
                letterSpacing: 0,
                fontWeight: '700',
              },
              text: 'Capture Mode',
              children: [],
            },
          ],
        },
      ],
    })

    render(
      <MemoryRouter initialEntries={['/mock-views?platform=ios&replay=1&capture=1']}>
        <Routes>
          <Route path="/mock-views" element={<ViewInfoPage mockOnly mockPlatform="ios" replayMode />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => expect(fetchMockViewSnapshotMock).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('2D')).toBeNull()
    expect(screen.queryByText('3D')).toBeNull()
    expect(screen.queryByText('refresh')).toBeNull()
    expect(screen.queryByText('ios')).toBeNull()
    expect(screen.getByTestId('replay-device-frame').getAttribute('data-platform')).toBe('ios')

    const scroller = screen.getByTestId('replay-device-frame').parentElement as HTMLElement | null
    expect(scroller).toBeTruthy()
    expect(scroller?.style.padding).toBe('0px')
    expect(scroller?.style.justifyContent).toBe('flex-start')
    expect(scroller?.style.alignItems).toBe('flex-start')
    expect(screen.getByText('Capture Mode')).toBeTruthy()
  })

  it.each([
    { platform: 'ios', text: 'Neptune SDK iOS Demo' },
    { platform: 'android', text: 'Neptune SDK Android Demo' },
    { platform: 'harmony', text: 'Neptune SDK Harmony Demo' },
  ] as const)('renders replay canvas for $platform with mobile text', async ({ platform, text }) => {
    fetchViewSnapshotMock.mockReset()
    fetchMockViewSnapshotMock.mockReset()

    fetchMockViewSnapshotMock.mockResolvedValue({
      snapshotId: `snap-${platform}`,
      capturedAt: '2026-03-27T12:00:00.000Z',
      platform,
      roots: [
        {
          id: 'window',
          parentId: null,
          name: 'Root',
          frame: { x: 0, y: 0, width: 390, height: 844 },
          children: [
            {
              id: 'title',
              parentId: 'window',
              name: 'Text',
              frame: { x: 20, y: 120, width: 300, height: 42 },
              style: {
                typographyUnit: 'dp',
                sourceTypographyUnit: platform === 'ios' ? 'pt' : platform === 'android' ? 'sp' : 'fp',
                platformFontScale: 1,
                fontSize: 34,
                lineHeight: 41,
                letterSpacing: 0,
                fontWeight: '700',
                textColor: '#FFFFFFFF',
              },
              text,
              children: [],
            },
          ],
        },
      ],
    })

    render(
      <MemoryRouter initialEntries={[`/mock-views?platform=${platform}&replay=1`]}>
        <Routes>
          <Route path="/mock-views" element={<ViewInfoPage mockOnly mockPlatform={platform} replayMode />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => expect(fetchMockViewSnapshotMock).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('replay-device-frame').getAttribute('data-platform')).toBe(platform)
    expect(screen.getByTestId('view-canvas-2d')).toBeTruthy()
    expect(screen.queryByText('View Info')).toBeNull()
    expect(screen.getByText(text)).toBeTruthy()
  })

  it('applies typography style in replay text rendering', async () => {
    fetchViewSnapshotMock.mockReset()
    fetchMockViewSnapshotMock.mockReset()

    fetchMockViewSnapshotMock.mockResolvedValue({
      snapshotId: 'snap-typo',
      capturedAt: '2026-03-27T12:00:00.000Z',
      platform: 'harmony',
      roots: [
        {
          id: 'window',
          parentId: null,
          name: 'Root',
          frame: { x: 0, y: 0, width: 390, height: 844 },
          children: [
            {
              id: 'title',
              parentId: 'window',
              name: 'Text',
              frame: { x: 20, y: 120, width: 320, height: 48 },
              style: {
                typographyUnit: 'dp',
                sourceTypographyUnit: 'fp',
                platformFontScale: 1.15,
                fontSize: 36,
                lineHeight: 44,
                letterSpacing: 0.4,
                fontWeight: '600',
                textColor: '#FFEAF4FF',
              },
              text: 'Harmony Typography',
              children: [],
            },
          ],
        },
      ],
    })

    render(
      <MemoryRouter initialEntries={['/mock-views?platform=harmony&replay=1']}>
        <Routes>
          <Route path="/mock-views" element={<ViewInfoPage mockOnly mockPlatform="harmony" replayMode />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => expect(fetchMockViewSnapshotMock).toHaveBeenCalledTimes(1))
    const textNode = screen.getByText('Harmony Typography')
    const el = textNode as HTMLElement
    expect(el.style.fontSize).toBe('36px')
    expect(el.style.lineHeight).toBe('44px')
    expect(el.style.fontWeight).toBe('600')
  })
})
