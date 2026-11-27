import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { isSupabaseConfigured } from '@/lib/supabase'
import { AuthProvider } from '@/hooks/useAuth'
import { AppLayout } from '@/components/layout/AppLayout'
import { RequireAuth, RequireRole } from '@/components/layout/RequireAuth'
import Login from '@/pages/Login'
import ResetPassword from '@/pages/ResetPassword'
import SetupRequired from '@/pages/SetupRequired'
import Dashboard from '@/pages/Dashboard'
import Leads from '@/pages/Leads'
import Imports from '@/pages/Imports'
import Admin from '@/pages/Admin'
import Crm from '@/pages/Crm'
import MapPage from '@/pages/MapPage'
import Agenda from '@/pages/Agenda'
import Proposals from '@/pages/Proposals'
import Clients from '@/pages/Clients'
import Services from '@/pages/Services'
import Reports from '@/pages/Reports'
import Intelligence from '@/pages/Intelligence'
import Opportunities from '@/pages/Opportunities'
import MyOperation from '@/pages/MyOperation'

export default function App() {
  if (!isSupabaseConfigured) return <SetupRequired />
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/redefinir-senha" element={<ResetPassword />} />
          <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
            <Route index element={<Dashboard />} />
            <Route path="leads" element={<Leads />} />
            <Route path="mapa" element={<MapPage />} />
            <Route path="minha-operacao" element={<MyOperation />} />
            <Route path="crm" element={<Crm />} />
            <Route path="inteligencia" element={<Intelligence />} />
            <Route path="oportunidades" element={<Opportunities />} />
            <Route path="agenda" element={<Agenda />} />
            <Route path="propostas" element={<Proposals />} />
            <Route path="clientes" element={<Clients />} />
            <Route path="servicos" element={<Services />} />
            <Route path="relatorios" element={<Reports />} />
            <Route path="importacao" element={<RequireRole roles={['admin', 'gestor']}><Imports /></RequireRole>} />
            <Route path="admin" element={<RequireRole roles={['admin']}><Admin /></RequireRole>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
