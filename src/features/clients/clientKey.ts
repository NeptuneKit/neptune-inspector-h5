import type { Client } from '../../types'

export type ClientIdentity = Pick<Client, 'platform' | 'appId' | 'sessionId' | 'deviceId'>

function toBase64(value: string): string {
  if (typeof btoa !== 'function') {
    throw new Error('btoa is not available in this environment')
  }

  return btoa(unescape(encodeURIComponent(value)))
}

function fromBase64(value: string): string {
  if (typeof atob !== 'function') {
    throw new Error('atob is not available in this environment')
  }

  return decodeURIComponent(escape(atob(value)))
}

function toBase64Url(value: string): string {
  return toBase64(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4))
  return fromBase64(normalized + padding)
}

export function encodeClientKey(identity: ClientIdentity): string {
  return toBase64Url(JSON.stringify([identity.platform, identity.appId, identity.sessionId, identity.deviceId]))
}

export function decodeClientKey(clientKey: string): ClientIdentity | null {
  try {
    const parsed = JSON.parse(fromBase64Url(clientKey))
    if (!Array.isArray(parsed) || parsed.length !== 4) {
      return null
    }

    const [platform, appId, sessionId, deviceId] = parsed
    if (
      typeof platform !== 'string' ||
      typeof appId !== 'string' ||
      typeof sessionId !== 'string' ||
      typeof deviceId !== 'string' ||
      !platform ||
      !appId ||
      !sessionId ||
      !deviceId
    ) {
      return null
    }

    return { platform, appId, sessionId, deviceId }
  } catch {
    return null
  }
}
