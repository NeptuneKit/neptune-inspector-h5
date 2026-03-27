import type { ViewTreeStyle } from '../../types'

function clampWeight(weight: number): number {
  if (!Number.isFinite(weight)) {
    return 400
  }
  const snapped = Math.round(weight / 100) * 100
  return Math.min(900, Math.max(100, snapped))
}

function parseCssWeight(raw: string): number | undefined {
  const numeric = Number.parseFloat(raw)
  if (Number.isFinite(numeric)) {
    return clampWeight(numeric)
  }
  const lowered = raw.trim().toLowerCase()
  if (lowered.length === 0) {
    return undefined
  }
  if (lowered.includes('thin')) return 100
  if (lowered.includes('extra light') || lowered.includes('ultralight')) return 200
  if (lowered.includes('light')) return 300
  if (lowered.includes('regular') || lowered.includes('normal')) return 400
  if (lowered.includes('medium')) return 500
  if (lowered.includes('semi') || lowered.includes('demi')) return 600
  if (lowered.includes('bold')) return 700
  if (lowered.includes('extra bold') || lowered.includes('heavy')) return 800
  if (lowered.includes('black')) return 900
  return undefined
}

function mapIosRawWeight(raw: number): number {
  if (raw <= -0.6) return 100
  if (raw <= -0.4) return 200
  if (raw <= -0.2) return 300
  if (raw <= 0.2) return 400
  if (raw <= 0.3) return 500
  if (raw <= 0.4) return 600
  if (raw <= 0.56) return 700
  if (raw <= 0.62) return 800
  return 900
}

function parseAndroidRawWeight(raw: string): number | undefined {
  const styleMatch = raw.match(/style\s*=\s*(-?\d+)/i)
  if (styleMatch === null) {
    return undefined
  }
  const styleValue = Number.parseInt(styleMatch[1], 10)
  if (!Number.isFinite(styleValue)) {
    return undefined
  }
  // Typeface.BOLD = 1, BOLD_ITALIC = 3
  return (styleValue & 1) === 1 ? 700 : 400
}

function parseRawWeight(raw: string): number | undefined {
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    return undefined
  }

  const androidWeight = parseAndroidRawWeight(trimmed)
  if (androidWeight !== undefined) {
    return androidWeight
  }

  const numeric = Number.parseFloat(trimmed)
  if (Number.isFinite(numeric) && trimmed.match(/^[-+]?\d*\.?\d+$/)) {
    if (numeric >= -1 && numeric <= 1) {
      return mapIosRawWeight(numeric)
    }
    return clampWeight(numeric)
  }

  return parseCssWeight(trimmed)
}

export function canonicalFontWeight(style: ViewTreeStyle | undefined): number | undefined {
  if (!style) {
    return undefined
  }
  if (style.fontWeight) {
    const fromFontWeight = parseCssWeight(style.fontWeight)
    if (fromFontWeight !== undefined) {
      return fromFontWeight
    }
  }
  if (style.fontWeightRaw) {
    return parseRawWeight(style.fontWeightRaw)
  }
  return undefined
}
