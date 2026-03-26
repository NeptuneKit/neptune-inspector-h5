import type { LogRecord } from '../../types'
import type { ClientIdentity } from '../clients/clientKey'

export function matchRecordToClient(record: LogRecord, identity: ClientIdentity): boolean {
  if (record.platform !== identity.platform) {
    return false
  }
  if (record.appId !== identity.appId) {
    return false
  }
  if (record.sessionId !== identity.sessionId) {
    return false
  }
  if (identity.deviceId && record.deviceId !== identity.deviceId) {
    return false
  }

  return true
}
