import { describe, expect, it } from 'vitest'
import { decodeClientKey, encodeClientKey } from '../src/features/clients/clientKey'

describe('client key codec', () => {
  it('encodes and decodes a client identity', () => {
    const identity = {
      platform: 'ios',
      appId: 'com.demo.app',
      sessionId: 'session-1',
      deviceId: 'device-1',
    } as const

    const encoded = encodeClientKey(identity)
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodeClientKey(encoded)).toEqual(identity)
  })

  it('returns null for malformed keys', () => {
    expect(decodeClientKey('bad-key')).toBeNull()
  })

  it('returns null for missing fields', () => {
    const malformed = btoa(JSON.stringify(['ios', 'app', 'session'])).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
    expect(decodeClientKey(malformed)).toBeNull()
  })
})
