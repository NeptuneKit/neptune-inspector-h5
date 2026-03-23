import { z } from 'zod'

export const platformSchema = z.enum(['ios', 'android', 'harmony', 'web'])
export const logLevelSchema = z.enum(['trace', 'debug', 'info', 'notice', 'warning', 'error', 'critical'])
export const sourceStatusSchema = z.enum(['online', 'offline', 'stale'])

export const logSourceSchema = z.object({
  sdkName: z.string().optional(),
  sdkVersion: z.string().optional(),
  file: z.string().optional(),
  function: z.string().optional(),
  line: z.number().int().nonnegative().optional(),
})

export const logRecordSchema = z.object({
  id: z.number().int(),
  timestamp: z.string(),
  level: logLevelSchema,
  message: z.string(),
  platform: platformSchema,
  appId: z.string(),
  sessionId: z.string(),
  deviceId: z.string(),
  category: z.string(),
  attributes: z.record(z.string()).optional(),
  source: logSourceSchema.optional(),
})

export const logPageSchema = z.object({
  records: z.array(logRecordSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
})

export const sourceSchema = z.object({
  platform: platformSchema,
  appId: z.string(),
  sessionId: z.string(),
  deviceId: z.string(),
  lastSeenAt: z.string(),
  sdkName: z.string().nullable().optional(),
  sdkVersion: z.string().nullable().optional(),
  status: sourceStatusSchema.nullable().optional(),
})

export const sourcesSchema = z.array(sourceSchema)

export const metricsSnapshotSchema = z.object({
  ingestAcceptedTotal: z.number(),
  sourceCount: z.number(),
  totalRecords: z.number(),
  droppedOverflow: z.number(),
})
