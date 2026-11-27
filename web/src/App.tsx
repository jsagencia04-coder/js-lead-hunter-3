import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { isSupabaseConfigured } from '@/lib/supabase'
import { AuthProvider } from '@/hooks/useAuth'
import { AppLayout } from '@/components/layout/AppLayout'
import { RequireAuth, RequireRole } from '@/components/layout/RequireAuth'
import Login from '@/pages/Login'
import ResetPassword from '@/pages/ResetPassword'
import SetupRequired from '@/pages/SetupRequired'
const Dashboard = lazy(() => import('@/pages/Dashboard'))
const Leads = lazy(() => import('@/pages/Leads'))
const Imports = lazy(() => import('@/pages/Imports'))
const Admin = lazy(() => import('@/pages/Admin'))
const Crm = lazy(() => import('@/pages/Crm'))
const MapPage = lazy(() => import('@/pages/MapPage'))
const Agenda = lazy(() => import('@/pages/Agenda'))
const Proposals = lazy(() => import('@/pages/Proposals'))
const Clients = lazy(() => import('@/pages/Clients'))
const Services = lazy(() => import('@/pages/Services'))
const Reports = lazy(() => import('@/pages/Reports'))
const Intelligence = lazy(() => import('@/pages/Intelligence'))
const Opportunities = lazy(() => import('@/pages/Opportunities'))
const MyOperation = lazy(() => import('@/pages/MyOperation'))
const BusinessRadar = lazy(() => import('@/pages/BusinessRadar'))
const SalesAutomations = lazy(() => import('@/pages/SalesAutomations'))
const Campaigns = lazy(() => import('@/pages/Campaigns'))
const ProposalDocument = lazy(() => import('@/pages/ProposalDocument'))
const OperationalAgents = lazy(() => import('@/pages/OperationalAgents'))
const MarketIntelligence = lazy(() => import('@/pages/MarketIntelligence'))
const SalesCopilot = lazy(() => import('@/pages/SalesCopilot'))
const RevenueIntelligence = lazy(() => import('@/pages/RevenueIntelligence'))
const IntelligenceSegments = lazy(() => import('@/pages/IntelligenceSegments'))
const CommercialConfiguration = lazy(() => import('@/pages/CommercialConfiguration'))
const CommercialLearning = lazy(() => import('@/pages/CommercialLearning'))
const SecurityGovernance = lazy(() => import('@/pages/SecurityGovernance'))
const ExecutiveOverview = lazy(() => import('@/pages/ExecutiveOverview'))
const OperationalCosts = lazy(() => import('@/pages/OperationalCosts'))
const ProposalTemplates = lazy(() => import('@/pages/ProposalTemplates'))

export default function App() {
  if (!isSupabaseConfigured) return <SetupRequired />
  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<p role="status" className="p-8 text-sm text-muted-foreground">Carregando módulo…</p>}>
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
            <Route path="radar" element={<BusinessRadar />} />
            <Route path="automacoes" element={<SalesAutomations />} />
            <Route path="agentes" element={<OperationalAgents />} />
            <Route path="mercado" element={<MarketIntelligence />} />
            <Route path="assistente" element={<SalesCopilot />} />
            <Route path="receita" element={<RevenueIntelligence />} />
            <Route path="segmentos" element={<IntelligenceSegments />} />
            <Route path="aprendizado" element={<RequireRole roles={['admin','gestor']}><CommercialLearning /></RequireRole>} />
            <Route path="executivo" element={<ExecutiveOverview />} />
            <Route path="modelos-proposta" element={<RequireRole roles={['admin','gestor']}><ProposalTemplates /></RequireRole>} />
            <Route path="consumo" element={<RequireRole roles={['admin','gestor']}><OperationalCosts /></RequireRole>} />
            <Route path="seguranca" element={<RequireRole roles={['admin','gestor']}><SecurityGovernance /></RequireRole>} />
            <Route path="configuracao-comercial" element={<RequireRole roles={['admin','gestor']}><CommercialConfiguration /></RequireRole>} />
            <Route path="oportunidades" element={<Opportunities />} />
            <Route path="agenda" element={<Agenda />} />
            <Route path="campanhas" element={<Campaigns />} />
            <Route path="propostas" element={<Proposals />} />
            <Route path="propostas/:id/documento" element={<ProposalDocument />} />
            <Route path="clientes" element={<Clients />} />
            <Route path="servicos" element={<Services />} />
            <Route path="relatorios" element={<Reports />} />
            <Route path="importacao" element={<RequireRole roles={['admin', 'gestor']}><Imports /></RequireRole>} />
            <Route path="admin" element={<RequireRole roles={['admin']}><Admin /></RequireRole>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  )
}
