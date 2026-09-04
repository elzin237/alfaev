import { Routes, Route } from "react-router";

import AuthGuard from "../guards/AuthGuard";

import LoginPage from "../../pages/auth/LoginPage";

import DashboardPage from "../../features/dashboard/DashboardPage";
import ProjectsPage from "../../pages/projects/ProjectsPage";
import ProcurementPage from "../../pages/procurement/ProcurementPage";
import InventoryPage from "../../pages/inventory/InventoryPage";
import PcbPage from "../../pages/pcb/PcbPage";
import WorkOrdersPage from "../../pages/work-orders/WorkOrdersPage";
import UsersPage from "../../pages/users/UsersPage";

function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<AuthGuard />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/procurement" element={<ProcurementPage />} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/pcb" element={<PcbPage />} />
        <Route path="/work-orders" element={<WorkOrdersPage />} />
        <Route path="/users" element={<UsersPage />} />
      </Route>
    </Routes>
  );
}

export default AppRouter;
