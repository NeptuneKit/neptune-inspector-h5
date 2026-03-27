import { describe, expect, it } from 'vitest'
import { canonicalFontWeight } from '../src/features/views/typography'

describe('typography fontWeight canonicalization', () => {
  it('maps iOS raw numeric weight to css weight', () => {
    expect(canonicalFontWeight({ fontWeightRaw: '0.4' })).toBe(600)
    expect(canonicalFontWeight({ fontWeightRaw: '0.56' })).toBe(700)
    expect(canonicalFontWeight({ fontWeightRaw: '-0.7' })).toBe(100)
  })

  it('maps Android raw style flag', () => {
    expect(canonicalFontWeight({ fontWeightRaw: 'style=1,fakeBold=false' })).toBe(700)
    expect(canonicalFontWeight({ fontWeightRaw: 'style=0,fakeBold=false' })).toBe(400)
    expect(canonicalFontWeight({ fontWeightRaw: 'style=3,fakeBold=true' })).toBe(700)
  })

  it('maps Harmony raw enum and explicit fontWeight first', () => {
    expect(canonicalFontWeight({ fontWeightRaw: 'FontWeight.Medium' })).toBe(500)
    expect(canonicalFontWeight({ fontWeightRaw: 'FontWeight.Bold' })).toBe(700)
    expect(canonicalFontWeight({ fontWeight: '600', fontWeightRaw: 'FontWeight.Bold' })).toBe(600)
  })
})
