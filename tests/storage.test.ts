import { afterEach, describe, expect, it, vi } from 'vitest'
import { safeStorageGet, safeStorageSet } from '../src/storage'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('safe storage', () => {
  it('uses localStorage when accessible', () => {
    const backing = new Map<string, string>()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => backing.get(key) ?? null,
        setItem: (key: string, value: string) => {
          backing.set(key, value)
        },
      },
    })

    safeStorageSet('base-url', 'http://127.0.0.1:18765')
    expect(safeStorageGet('base-url')).toBe('http://127.0.0.1:18765')
  })

  it('falls back when localStorage access throws', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('denied')
        },
        setItem: () => {
          throw new Error('denied')
        },
      },
    })

    safeStorageSet('base-url', 'http://127.0.0.1:18765')
    expect(safeStorageGet('base-url')).toBe('http://127.0.0.1:18765')
  })
})
