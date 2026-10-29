import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it } from "vitest";

import type { FinishedWorkOrderDetail } from "../services/finishedWorkOrderService";
import type { PcbProductionWorkOrderContext } from "../services/pcbProductionWorkOrderService";
import FinishedWorkOrderView from "./FinishedWorkOrderView";

const detail: FinishedWorkOrderDetail = {
  id: "wo-1", workOrderNumber: "RN-2026-0040", projectId: "project-1",
  projectName: "Project Alpha", customerName: "Customer Alpha", description: "Completed production\nSecond line",
  createdAt: "2026-10-27T10:00:00Z", finishedAt: "2026-10-28T11:00:00Z",
  finishedByUserId: "user-1", finishedByFullName: "Ada Lovelace",
  pdf: { id: "pdf-1", documentVersion: 1, generatedAt: "2026-10-28T11:00:00Z" },
};
const context: PcbProductionWorkOrderContext = {
  workOrderId: detail.id, pcbCardId: "card-1", pcbCardName: "Finished Controller", bomVersionId: "bom-1",
  bomVersionNumber: "9007199254740993", plannedQuantity: "9223372036854775807", outputProductId: "product-1",
  outputSerialNumber: "001", outputProductName: "Controller Output", actualGoodQuantity: "9007199254740995",
};

function show(saved = detail, productionContext: PcbProductionWorkOrderContext | null = context) {
  return render(<MemoryRouter><FinishedWorkOrderView detail={saved} productionContext={productionContext} materials={[]} movements={[]} /></MemoryRouter>);
}
afterEach(cleanup);

it("renders distinct neutral production-result and compact completion-details cards, not the Draft overview", () => {
  show();
  const result = screen.getByRole("region", { name: "Production Result" });
  const completion = screen.getByRole("region", { name: "Completion Details" });
  expect(result).toHaveClass("bg-white", "border-zinc-200");
  expect(result).not.toHaveClass("bg-sky-50");
  expect(completion).toHaveClass("bg-white", "p-5", "sm:p-6");
  expect(result).not.toContainElement(completion);
  expect(within(result).getByRole("heading", { name: context.pcbCardName })).toHaveClass("font-bold", "sm:text-3xl");
  expect(within(result).getByText("Completed")).toHaveClass("bg-emerald-50");
  expect(within(result).getByText(context.outputSerialNumber)).toHaveClass("font-mono");
  expect(within(result).getByText(context.outputProductName)).toBeInTheDocument();
  expect(within(result).getByText(`v${context.bomVersionNumber}`)).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Work Order overview" })).not.toBeInTheDocument();
  expect(screen.queryByText("Work Order Details")).not.toBeInTheDocument();
});

it("displays exact saved planned and actual quantities in balanced responsive tiles, emphasizing actual output", () => {
  show();
  const result = screen.getByRole("region", { name: "Production Result" });
  const planned = within(result).getByText(context.plannedQuantity);
  const actual = within(result).getByText(context.actualGoodQuantity!);
  expect(planned).toHaveClass("tabular-nums", "font-semibold");
  expect(actual).toHaveClass("tabular-nums", "font-bold", "text-emerald-900");
  expect(planned.parentElement?.parentElement).toBe(actual.parentElement?.parentElement);
  expect(planned.closest("dl")).toHaveClass("grid", "sm:grid-cols-2");
  for (const label of ["Planned Quantity", "Actual Completed", "Destination", "BOM Version"]) expect(within(result).getByText(label)).toBeInTheDocument();
});

it("keeps real completion metadata and existing date formatting, with a full-width description footer", () => {
  show();
  const completion = screen.getByRole("region", { name: "Completion Details" });
  for (const label of ["Finished Date", "Finished By", "Project", "Customer", "Description"]) expect(within(completion).getByText(label)).toBeInTheDocument();
  expect(within(completion).getByText(detail.finishedByFullName)).toBeInTheDocument();
  expect(within(completion).getByText(detail.customerName!)).toBeInTheDocument();
  expect(within(completion).getByText(detail.projectName!)).toBeInTheDocument();
  const time = completion.querySelector("time");
  expect(time).toHaveAttribute("datetime", detail.finishedAt);
  expect(time).toHaveTextContent(new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(detail.finishedAt)));
  expect(within(completion).getByText("Completed production Second line").parentElement?.parentElement).toHaveClass("sm:col-span-2", "xl:col-span-4", "border-t");
});

it("preserves General Stock and missing actual/customer fallbacks without fabricating quantities", () => {
  show({ ...detail, projectId: null, projectName: null, customerName: null }, { ...context, actualGoodQuantity: null });
  expect(screen.getAllByText("General Stock")).toHaveLength(2);
  expect(screen.getByText("Not required")).toBeInTheDocument();
  expect(screen.getByText("Not recorded")).toBeInTheDocument();
});

it("preserves recorded zero output as zero rather than a missing result", () => {
  show(detail, { ...context, actualGoodQuantity: "0" });
  expect(within(screen.getByRole("region", { name: "Production Result" })).getByText("0")).toBeInTheDocument();
  expect(screen.queryByText("Not recorded")).not.toBeInTheDocument();
});

it("supports long identities and multiline content without fixed heights or unbreakable quantity tiles", () => {
  const pcbCardName = "LONG-FINISHED-PRODUCT-".repeat(12);
  show(detail, { ...context, pcbCardName });
  expect(screen.getByRole("heading", { name: pcbCardName })).toHaveClass("[overflow-wrap:anywhere]");
  expect(screen.getByText(context.actualGoodQuantity!)).toHaveClass("[overflow-wrap:anywhere]");
  expect(screen.getByText("Completed production Second line")).toHaveClass("whitespace-pre-wrap", "[overflow-wrap:anywhere]");
  expect(screen.getByRole("region", { name: "Completion Details" }).querySelector("dl")).toHaveClass("sm:grid-cols-2", "xl:grid-cols-4");
});

it("preserves Materials, movements, PDF navigation and read-only completion behavior", () => {
  show();
  expect(screen.getByRole("region", { name: "Materials" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Inventory Movements" })).toBeInTheDocument();
  expect(screen.getByText("No materials")).toBeInTheDocument();
  expect(screen.getByText("No linked Inventory movements")).toBeInTheDocument();
  const pdf = screen.getByRole("link", { name: "Open PDF" });
  expect(pdf).toHaveAttribute("href", `/work-orders/${detail.id}/pdf`);
  expect(pdf).toHaveAttribute("target", "_blank");
  expect(pdf).toHaveAttribute("rel", "noopener noreferrer");
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

it("leaves non-PCB finished Work Order details and honest missing-PDF state unchanged", () => {
  show({ ...detail, pdf: null }, null);
  expect(screen.getByRole("heading", { name: "Work Order Details" })).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Production Result" })).not.toBeInTheDocument();
  expect(screen.queryByText("Completed")).not.toBeInTheDocument();
  expect(screen.getByText(detail.finishedByFullName)).toBeInTheDocument();
  expect(screen.getByText("No official PDF metadata is available for this Work Order.")).toBeInTheDocument();
});
