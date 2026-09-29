import { describe } from "vitest";

import { registerSecurityFixture } from "./helpers/fixture-lifecycle";
import { registerAuthTests } from "./auth.suite";
import { registerUsersTests } from "./users.suite";
import { registerPermissionsTests } from "./permissions.suite";
import { registerBrandsTests } from "./brands.suite";
import { registerSuppliersTests } from "./suppliers.suite";
import { registerProductEditTests, registerProductSchemaTests } from "./products.suite";
import { registerBulkComponentImportTests } from "./bulk-component-import.suite";
import { registerWorkOrderSchemaTests } from "./work-orders.suite";
import { registerWorkOrderFinishPreflightTests } from "./work-order-finish-preflight.suite";
import { registerInventoryLedgerTests } from "./inventory-ledger.suite";
import { registerInventoryPrimitiveTests, registerManualInventoryAdjustmentTests } from "./inventory-mutation.suite";
import { registerInventoryReadsTests } from "./inventory-reads.suite";
import { registerProductSuppliersTests } from "./product-suppliers.suite";
import { registerProjectsTests } from "./projects.suite";
import { registerProjectPlanningTests } from "./project-planning.suite";
import { registerProcurementReadsTests } from "./procurement-reads.suite";
import { registerProcurementCreationTests } from "./procurement-creation.suite";
import { registerProcurementLifecycleTests, registerProcurementProductConcurrencyTests } from "./procurement-lifecycle.suite";
import { registerPcbTests } from "./pcb.suite";

describe("Supabase security helpers", () => {
  // Register domain suites under one fixture lifecycle to avoid repeated Auth setup.
  const requireHarness = registerSecurityFixture();
  registerAuthTests(requireHarness);
  registerUsersTests(requireHarness);
  registerPermissionsTests(requireHarness);
  registerBrandsTests(requireHarness);
  registerSuppliersTests(requireHarness);
  registerProductSchemaTests(requireHarness);
  registerBulkComponentImportTests(requireHarness);
  registerWorkOrderSchemaTests(requireHarness);
  registerWorkOrderFinishPreflightTests(requireHarness);
  registerInventoryLedgerTests(requireHarness);
  registerInventoryPrimitiveTests(requireHarness);
  registerProductEditTests(requireHarness);
  registerProductSuppliersTests(requireHarness);
  registerManualInventoryAdjustmentTests(requireHarness);
  registerInventoryReadsTests(requireHarness);
  registerProjectsTests(requireHarness);
  registerProjectPlanningTests(requireHarness);
  registerProcurementReadsTests(requireHarness);
  registerProcurementCreationTests(requireHarness);
  registerProcurementLifecycleTests(requireHarness);
  registerPcbTests(requireHarness);
  registerProcurementProductConcurrencyTests(requireHarness);
});
