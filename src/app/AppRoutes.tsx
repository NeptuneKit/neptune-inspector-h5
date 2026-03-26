import { Navigate, Route, Routes } from 'react-router-dom'
import { ClientsPage } from '../pages/ClientsPage'
import { ClientDetailPage } from '../pages/ClientDetailPage'

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<ClientsPage />} />
      <Route path="/clients/:clientKey" element={<ClientDetailPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
