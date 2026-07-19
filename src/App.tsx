import { Route, Routes } from 'react-router'
import Layout from '@/components/Layout'
import { UserProvider } from '@/hooks/useUser'
import Dashboard from '@/pages/Dashboard'
import Lineage from '@/pages/Lineage'
import Sql from '@/pages/Sql'
import Metadata from '@/pages/Metadata'
import Changes from '@/pages/Changes'

export default function App() {
  return (
    <UserProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="lineage" element={<Lineage />} />
          <Route path="sql" element={<Sql />} />
          <Route path="metadata" element={<Metadata />} />
          <Route path="changes" element={<Changes />} />
        </Route>
      </Routes>
    </UserProvider>
  )
}
