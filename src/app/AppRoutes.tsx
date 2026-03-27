import { Navigate, Route, Routes } from 'react-router-dom'
import { ClientsPage } from '../pages/ClientsPage'
import { ClientDetailPage } from '../pages/ClientDetailPage'
import { ViewInfoPage } from '../pages/ViewInfoPage'
import { LogInfoPage } from '../pages/LogInfoPage'
import { MockViewsPage } from '../pages/MockViewsPage'

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<ClientsPage />} />
      <Route path="/clients/:clientKey" element={<ClientDetailPage />} />
      <Route path="/clients/:clientKey/logs" element={<LogInfoPage />} />
      <Route path="/clients/:clientKey/views" element={<ViewInfoPage />} />
      <Route path="/mock-views" element={<MockViewsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
