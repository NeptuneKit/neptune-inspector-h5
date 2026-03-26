import { z } from 'zod'
import { fetchJson, normalizeBaseUrl } from '../../api'
import { clientSchema } from '../../schemas'
import type { Client } from '../../types'

const clientListSchema = z.object({
  items: z.array(clientSchema),
})

export function buildClientsUrl(baseUrl: string): string {
  return new URL('/v2/clients', normalizeBaseUrl(baseUrl)).toString()
}

export async function fetchClientsSnapshot(baseUrl: string): Promise<Client[]> {
  const payload = await fetchJson(buildClientsUrl(baseUrl), clientListSchema, 'clients')
  return payload.items.sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt))
}
