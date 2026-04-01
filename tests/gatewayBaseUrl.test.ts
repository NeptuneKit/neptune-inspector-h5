import { describe, expect, it } from 'vitest'
import { resolveInitialBaseUrl } from '../src/shared/gateway'

describe('resolveInitialBaseUrl', () => {
  it('prefers gateway query parameter', () => {
    const url = resolveInitialBaseUrl(
      'http://127.0.0.1:18765',
      'http://127.0.0.1:18765',
      '?gateway=http://127.0.0.1:18771',
      'http://127.0.0.1:18880',
    )
    expect(url).toBe('http://127.0.0.1:18771')
  })

  it('prefers runtime env over stored value when query not provided', () => {
    const url = resolveInitialBaseUrl(
      'http://127.0.0.1:18888',
      'http://127.0.0.1:18765',
      '',
      'http://127.0.0.1:18880',
    )
    expect(url).toBe('http://127.0.0.1:18880')
  })

  it('falls back to stored value when query not provided', () => {
    const url = resolveInitialBaseUrl(
      'http://127.0.0.1:18888',
      'http://127.0.0.1:18765',
      '',
      null,
    )
    expect(url).toBe('http://127.0.0.1:18888')
  })

  it('uses fallback when both query and stored are empty', () => {
    const url = resolveInitialBaseUrl(
      '',
      'http://127.0.0.1:18765',
      '',
      null,
    )
    expect(url).toBe('http://127.0.0.1:18765')
  })
})
