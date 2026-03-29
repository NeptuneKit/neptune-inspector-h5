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
  nextCursor: z.string().nullable().optional().default(null),
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

export const clientSchema = z.object({
  platform: platformSchema,
  appId: z.string(),
  deviceId: z.string(),
  sessionId: z.string(),
  callbackEndpoint: z.string(),
  lastSeenAt: z.string(),
  ttlSeconds: z.number().int().nonnegative(),
  sdkName: z.string().nullable().optional(),
  sdkVersion: z.string().nullable().optional(),
})

export const clientsSchema = z.array(clientSchema)

export const selectedClientIdentitySchema = z.object({
  platform: platformSchema,
  appId: z.string(),
  deviceId: z.string(),
  sessionId: z.string(),
})

export const selectedClientsPayloadSchema = z.object({
  selected: z.array(selectedClientIdentitySchema),
})

export const metricsSnapshotSchema = z.object({
  ingestAcceptedTotal: z.number(),
  sourceCount: z.number(),
  retainedRecordCount: z.number(),
  retentionMaxRecordCount: z.number(),
  retentionMaxAgeSeconds: z.number(),
  retentionDroppedTotal: z.number(),
})

export const viewTreeNodeSchema: z.ZodType<{
  id: string
  parentId: string | null
  name: string
  frame?: {
    x: number
    y: number
    width: number
    height: number
  }
  style?: {
    opacity?: number
    backgroundColor?: string
    textColor?: string
    typographyUnit?: 'dp'
    sourceTypographyUnit?: 'pt' | 'sp' | 'fp' | 'vp' | 'px' | 'dp'
    platformFontScale?: number
    fontSize?: number
    lineHeight?: number
    letterSpacing?: number
    fontWeight?: string
    fontWeightRaw?: string
    borderRadius?: number
    borderWidth?: number
    borderColor?: string
    zIndex?: number
  }
  rawNode?: unknown
  text?: string | null
  visible?: boolean
  children: unknown[]
}> = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  name: z.string(),
  frame: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }).optional(),
  style: z.object({
    opacity: z.number().optional(),
    backgroundColor: z.string().optional(),
    textColor: z.string().optional(),
    typographyUnit: z.literal('dp').optional(),
    sourceTypographyUnit: z.enum(['pt', 'sp', 'fp', 'vp', 'px', 'dp']).optional(),
    platformFontScale: z.number().optional(),
    fontSize: z.number().optional(),
    lineHeight: z.number().optional(),
    letterSpacing: z.number().optional(),
    fontWeight: z.string().optional(),
    fontWeightRaw: z.string().optional(),
    fontFamily: z.string().optional(),
    borderRadius: z.number().optional(),
    borderWidth: z.number().optional(),
    borderColor: z.string().optional(),
    zIndex: z.number().optional(),
    textAlign: z.string().optional(),
    textContentAlign: z.string().optional(),
    textOverflow: z.string().optional(),
    wordBreak: z.string().optional(),
    paddingTop: z.number().optional(),
    paddingRight: z.number().optional(),
    paddingBottom: z.number().optional(),
    paddingLeft: z.number().optional(),
  }).optional(),
  rawNode: z.unknown().optional(),
  text: z.string().nullable().optional(),
  visible: z.boolean().optional(),
  children: z.array(z.lazy(() => viewTreeNodeSchema)),
})

export const viewTreeSnapshotSchema = z.object({
  snapshotId: z.string(),
  capturedAt: z.string(),
  platform: platformSchema,
  roots: z.array(viewTreeNodeSchema),
})

export const inspectorSnapshotSchema = z.object({
  snapshotId: z.string(),
  capturedAt: z.string(),
  platform: platformSchema,
  available: z.boolean(),
  payload: z.unknown().nullable(),
  reason: z.string().nullable().optional(),
})
