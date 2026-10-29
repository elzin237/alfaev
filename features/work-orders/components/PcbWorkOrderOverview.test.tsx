import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { WorkOrderDetail } from "../services/workOrderService";
import type { PcbProductionWorkOrderContext } from "../services/pcbProductionWorkOrderService";
import PcbWorkOrderOverview from "./PcbWorkOrderOverview";

const workOrder: WorkOrderDetail = {
  id: "wo-1", workOrderNumber: "RN-2026-0041", status: "draft", projectId: "project-1",
  projectName: "Project Alpha", customerName: "Customer Alpha", description: "Saved production description",
  createdAt: "2026-10-28T10:00:00Z", updatedAt: "2026-10-28T11:00:00Z",
};
const context: PcbProductionWorkOrderContext = {
  workOrderId: workOrder.id, pcbCardId: "card-1", pcbCardName: "Finished Controller", bomVersionId: "bom-1",
  bomVersionNumber: "9007199254740993", plannedQuantity: "9223372036854775807", outputProductId: "product-1",
  outputSerialNumber: "001", outputProductName: "Controller Output", actualGoodQuantity: null,
};
afterEach(cleanup);

it("shows all frozen PCB and saved Draft details in one compact white overview", () => {
  render(<PcbWorkOrderOverview workOrder={workOrder} productionContext={context} />);
  const overview = screen.getByRole("region", { name: "Work Order overview" });
  expect(overview).toHaveClass("bg-white", "border-t-sky-300", "p-5", "sm:p-6");
  expect(overview).not.toHaveClass("bg-sky-50");
  expect(within(overview).getByRole("heading", { name: context.pcbCardName })).toHaveClass("font-bold", "sm:text-3xl");
  for (const label of ["Finished Product", "Planned Quantity", "Output Product", "Destination", "Project", "Customer", "Short Description"]) expect(within(overview).getByText(label)).toBeInTheDocument();
  expect(within(overview).getByText(`BOM v${context.bomVersionNumber}`)).toBeInTheDocument();
  expect(within(overview).getByText(context.plannedQuantity)).toBeInTheDocument();
  expect(within(overview).getByText("001 — Controller Output")).toBeInTheDocument();
  expect(within(overview).getAllByText("Project Alpha")).toHaveLength(2);
  expect(within(overview).getByText("Customer Alpha")).toBeInTheDocument();
  expect(within(overview).getByText(workOrder.description!)).toBeInTheDocument();
  expect(within(overview).getByText("The production plan and BOM materials are locked. Additional materials may be added to the Draft.")).toBeInTheDocument();
  expect(overview.querySelector("dl")).toHaveClass("sm:grid-cols-2", "lg:grid-cols-3");
  expect(within(overview).queryByRole("textbox")).not.toBeInTheDocument();
  expect(within(overview).queryByRole("button")).not.toBeInTheDocument();
});

it.each([ ["draft", "Draft"], ["finished", "Finished"] ] as const)("uses the actual %s status, never a planned production status", (status, label) => {
  render(<PcbWorkOrderOverview workOrder={{ ...workOrder, status }} productionContext={context} />);
  expect(screen.getAllByText(label)).toHaveLength(1);
  expect(screen.queryByText("Planned")).not.toBeInTheDocument();
});

it("preserves General Stock, missing Project, Customer and description fallbacks", () => {
  render(<PcbWorkOrderOverview workOrder={{ ...workOrder, projectId: null, projectName: null, customerName: null, description: null }} productionContext={context} />);
  expect(screen.getByText("General Stock")).toBeInTheDocument();
  expect(screen.getByText("Not selected")).toBeInTheDocument();
  expect(screen.getAllByText("Not set")).toHaveLength(2);
});

it("allows long frozen identities and multiline descriptions to wrap without fixed heights", () => {
  const pcbCardName = "LONG-PCB-PRODUCT-".repeat(12);
  render(<PcbWorkOrderOverview workOrder={{ ...workOrder, description: "First line\nSecond line" }} productionContext={{ ...context, pcbCardName }} />);
  expect(screen.getByRole("heading", { name: pcbCardName })).toHaveClass("[overflow-wrap:anywhere]", "min-w-0");
  expect(screen.getByText("First line Second line")).toHaveClass("whitespace-pre-wrap", "[overflow-wrap:anywhere]");
});
