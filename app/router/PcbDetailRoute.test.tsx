import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Outlet } from "react-router";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("../guards/AuthGuard", () => ({ default: () => <Outlet /> }));
vi.mock("../guards/PermissionRoute", () => ({
  default: ({ permission }: { permission: string }) =>
    <div data-testid="permission-route" data-permission={permission}><Outlet /></div>,
}));
vi.mock("../../features/pcb/PcbDetailPage", () => ({ default: () => <div>PCB BOM detail</div> }));

import AppRouter from "./AppRouter";

afterEach(() => { cleanup(); });

it("keeps /pcb/:pcbCardId under the existing pcb.view route boundary", () => {
  render(<MemoryRouter initialEntries={["/pcb/11111111-1111-4111-8111-111111111111"]}>
    <AppRouter />
  </MemoryRouter>);
  expect(screen.getByText("PCB BOM detail")).toBeInTheDocument();
  expect(screen.getByTestId("permission-route")).toHaveAttribute("data-permission", "pcb.view");
});
