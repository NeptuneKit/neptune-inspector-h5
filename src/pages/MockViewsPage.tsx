import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ViewInfoPage } from './ViewInfoPage'
import type { MockPlatform } from '../features/views/viewService'

function normalizeMockPlatform(value: string | null): MockPlatform {
  if (value === 'ios' || value === 'android' || value === 'harmony') {
    return value
  }
  return 'harmony'
}

export function MockViewsPage() {
  const [searchParams] = useSearchParams()
  const platform = useMemo(() => normalizeMockPlatform(searchParams.get('platform')), [searchParams])
  return <ViewInfoPage mockOnly mockPlatform={platform} />
}
