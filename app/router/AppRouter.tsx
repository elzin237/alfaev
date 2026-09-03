import { Routes, Route } from "react-router";

import AuthGuard from "../guards/AuthGuard";

import LoginPage from "../../pages/auth/LoginPage";

import DashboardPage from "../../pages/dashboard/DashboardPage";
import ProjectsPage from "../../pages/projects/ProjectsPage";
import DocumentsPage from "../../pages/documents/DocumentsPage";
import ProcurementPage from "../../pages/procurement/ProcurementPage";
import InventoryPage from "../../pages/inventory/InventoryPage";
import ProductionPage from "../../pages/production/ProductionPage";
import PcbPage from "../../pages/pcb/PcbPage";
import WorkOrdersPage from "../../pages/work-orders/WorkOrdersPage";
import QualityPage from "../../pages/quality/QualityPage";
import ReportsPage from "../../pages/reports/ReportsPage";
import UsersPage from "../../pages/users/UsersPage";
import SettingsPage from "../../pages/settings/SettingsPage";

function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<AuthGuard />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/documents" element={<DocumentsPage />} />
        <Route path="/procurement" element={<ProcurementPage />} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/production" element={<ProductionPage />} />
        <Route path="/pcb" element={<PcbPage />} />
        <Route path="/work-orders" element={<WorkOrdersPage />} />
        <Route path="/quality" element={<QualityPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}

export default AppRouter;
