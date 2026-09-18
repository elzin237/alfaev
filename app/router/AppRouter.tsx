import { Routes, Route } from "react-router";

import AuthGuard from "../guards/AuthGuard";
import AdminRoute from "../guards/AdminRoute";
import PermissionRoute from "../guards/PermissionRoute";

import LoginPage from "../../pages/auth/LoginPage";

import DashboardPage from "../../features/dashboard/DashboardPage";
import ProjectsPage from "../../features/projects/ProjectsPage";
import ProjectDetailPage from "../../features/projects/ProjectDetailPage";
import ProcurementPage from "../../features/procurement/ProcurementPage";
import SuppliersPage from "../../features/suppliers/SuppliersPage";
import SupplierDetailPage from "../../features/suppliers/SupplierDetailPage";
import InventoryPage from "../../features/inventory/InventoryPage";
import ProductDetailPage from "../../features/inventory/ProductDetailPage";
import PcbPage from "../../features/pcb/PcbPage";
import PcbDetailPage from "../../features/pcb/PcbDetailPage";
import PcbProductionPrecheckPage from "../../features/pcb/PcbProductionPrecheckPage";
import WorkOrdersPage from "../../pages/work-orders/WorkOrdersPage";
import UsersPage from "../../features/users/UsersPage";
import UserDetailPage from "../../features/users/UserDetailPage";
import DocumentationPage from "../../features/documentation/DocumentationPage";
import FixedAssetsPage from "../../features/fixed-assets/FixedAssetsPage";

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
          <Route
            path="/projects/:projectId"
            element={<ProjectDetailPage />}
          />
        </Route>
        <Route element={<PermissionRoute permission="procurement.view" />}>
          <Route path="/procurement" element={<ProcurementPage />} />
        </Route>
        <Route element={<PermissionRoute permission="suppliers.view" />}>
          <Route path="/suppliers" element={<SuppliersPage />} />
          <Route
            path="/suppliers/:supplierId"
            element={<SupplierDetailPage />}
          />
        </Route>
        <Route element={<PermissionRoute permission="inventory.view" />}>
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/inventory/:productId" element={<ProductDetailPage />} />
        </Route>
        <Route element={<PermissionRoute permission="pcb.view" />}>
          <Route path="/pcb" element={<PcbPage />} />
          <Route path="/pcb/:pcbCardId" element={<PcbDetailPage />} />
        </Route>
        <Route element={<PermissionRoute permission="pcb.produce" />}>
          <Route path="/pcb/:pcbCardId/produce" element={<PcbProductionPrecheckPage />} />
        </Route>
        <Route element={<PermissionRoute permission="work_orders.view" />}>
          <Route path="/work-orders" element={<WorkOrdersPage />} />
        </Route>
        <Route element={<AdminRoute />}>
          <Route path="/documents" element={<DocumentationPage />} />
          <Route path="/fixed-assets" element={<FixedAssetsPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/users/:userId" element={<UserDetailPage />} />
        </Route>
      </Route>
    </Routes>
  );
}

export default AppRouter;
