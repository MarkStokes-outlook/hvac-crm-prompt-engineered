import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { Login } from "./pages/Login";
import { OfficeLayout } from "./components/OfficeLayout";
import { Dashboard } from "./pages/Dashboard";
import { JobsList } from "./pages/JobsList";
import { JobDetail } from "./pages/JobDetail";
import { NewJob } from "./pages/NewJob";
import { Schedule } from "./pages/Schedule";
import { CustomersList } from "./pages/CustomersList";
import { CustomerDetail } from "./pages/CustomerDetail";
import { SiteDetail } from "./pages/SiteDetail";
import { EquipmentDetail } from "./pages/EquipmentDetail";
import { ContractsList, ContractDetail } from "./pages/Contracts";
import { QuotesList } from "./pages/QuotesList";
import { QuoteDetail } from "./pages/QuoteDetail";
import { QuoteEditor } from "./pages/QuoteEditor";
import { Recommendations } from "./pages/Recommendations";
import { Stock } from "./pages/Stock";
import { PurchaseOrderDetail, NewPurchaseOrder } from "./pages/PurchaseOrders";
import { Settings } from "./pages/Settings";
import { EngineerApp } from "./engineer/EngineerApp";

export function App() {
  const { me } = useAuth();
  if (!me) return <Login />;
  if (me.role === "engineer") return <EngineerApp />;
  return (
    <OfficeLayout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/jobs" element={<JobsList />} />
        <Route path="/jobs/new" element={<NewJob />} />
        <Route path="/jobs/:id" element={<JobDetail />} />
        <Route path="/schedule" element={<Schedule />} />
        <Route path="/customers" element={<CustomersList />} />
        <Route path="/customers/:id" element={<CustomerDetail />} />
        <Route path="/sites/:id" element={<SiteDetail />} />
        <Route path="/equipment/:id" element={<EquipmentDetail />} />
        <Route path="/contracts" element={<ContractsList />} />
        <Route path="/contracts/:id" element={<ContractDetail />} />
        <Route path="/quotes" element={<QuotesList />} />
        <Route path="/quotes/new" element={<QuoteEditor />} />
        <Route path="/quotes/:id" element={<QuoteDetail />} />
        <Route path="/quotes/:id/edit" element={<QuoteEditor />} />
        <Route path="/recommendations" element={<Recommendations />} />
        <Route path="/stock" element={<Stock />} />
        <Route path="/purchase-orders/new" element={<NewPurchaseOrder />} />
        <Route path="/purchase-orders/:id" element={<PurchaseOrderDetail />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </OfficeLayout>
  );
}
