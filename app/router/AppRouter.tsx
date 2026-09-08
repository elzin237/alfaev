import { Routes, Route } from "react-router";

import AuthGuard from "../guards/AuthGuard";
import AdminRoute from "../guards/AdminRoute";
import PermissionRoute from "../guards/PermissionRoute";

import LoginPage from "../../pages/auth/LoginPage";

import DashboardPage from "../../features/dashboard/DashboardPage";
import ProjectsPage from "../../pages/projects/ProjectsPage";
import ProcurementPage from "../../pages/procurement/ProcurementPage";
import InventoryPage from "../../pages/inventory/InventoryPage";
import PcbPage from "../../pages/pcb/PcbPage";
import WorkOrdersPage from "../../pages/work-orders/WorkOrdersPage";
import UsersPage from "../../features/users/UsersPage";
import UserDetailPage from "../../features/users/UserDetailPage";

function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<AuthGuard />}>
        <Route element={<PermissionRoute permission="dashboard.view" />}>
          <Route path="/" element={<DashboardPage />} />
        </Route>
        <Route element={<PermissionRoute permission="projects.view" />}>
          <Route path="/projects" element={<ProjectsPage />} />
        </Route>
        <Route element={<PermissionRoute permission="procurement.view" />}>
          <Route path="/procurement" element={<ProcurementPage />} />
        </Route>
        <Route element={<PermissionRoute permission="inventory.view" />}>
          <Route path="/inventory" element={<InventoryPage />} />
        </Route>
        <Route element={<PermissionRoute permission="pcb.view" />}>
          <Route path="/pcb" element={<PcbPage />} />
        </Route>
        <Route element={<PermissionRoute permission="work_orders.view" />}>
          <Route path="/work-orders" element={<WorkOrdersPage />} />
        </Route>
        <Route element={<AdminRoute />}>
          <Route path="/users" element={<UsersPage />} />
          <Route path="/users/:userId" element={<UserDetailPage />} />
        </Route>
      </Route>
    </Routes>
  );
}

export default AppRouter;
