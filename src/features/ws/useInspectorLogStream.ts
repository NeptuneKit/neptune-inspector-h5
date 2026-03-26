import { useEffect, useRef } from 'react'
import { createInspectorWsClient } from '../../ws'
import type { LogRecord } from '../../types'
import type { ClientIdentity } from '../clients/clientKey'
import { matchRecordToClient } from '../logs/logMatch'

interface UseInspectorLogStreamOptions {
  baseUrl: string
  identity: ClientIdentity | null
  onRecord: (record: LogRecord) => void
  onStatusChange: (snapshot: { connected: boolean; status: string }) => void
}

export function useInspectorLogStream(options: UseInspectorLogStreamOptions): void {
  const onRecordRef = useRef(options.onRecord)
  const onStatusChangeRef = useRef(options.onStatusChange)

  useEffect(() => {
    onRecordRef.current = options.onRecord
  }, [options.onRecord])

  useEffect(() => {
    onStatusChangeRef.current = options.onStatusChange
  }, [options.onStatusChange])

  useEffect(() => {
    const identity = options.identity
    if (!identity) {
      return
    }

    const client = createInspectorWsClient({
      baseUrl: options.baseUrl,
      onConnectionChange: (snapshot) => {
        onStatusChangeRef.current(snapshot)
      },
      onLogRecord: (record) => {
        if (!matchRecordToClient(record, identity)) {
          return
        }
        onRecordRef.current(record)
      },
    })

    client.start()
    return () => {
      client.stop()
    }
  }, [
    options.baseUrl,
    options.identity?.platform,
    options.identity?.appId,
    options.identity?.sessionId,
    options.identity?.deviceId,
  ])
}
