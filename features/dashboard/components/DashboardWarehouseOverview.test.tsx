import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { MemoryRouter } from "react-router";
import DashboardWarehouseOverview from "./DashboardWarehouseOverview";
afterEach(cleanup);

it("shows unavailable counts rather than fabricated stock classifications or zeroes", () => {
  render(<DashboardWarehouseOverview />, {wrapper: MemoryRouter});
  expect(screen.getAllByText("Counts unavailable")).toHaveLength(3);
  for (const name of ["Raw Materials", "Customs", "Finished Goods"]) expect(screen.getByText(name)).toBeInTheDocument();
  expect(screen.queryByText("0")).not.toBeInTheDocument();
  expect(screen.queryByText(/Healthy Stock|Below Minimum/)).not.toBeInTheDocument();
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(screen.getByRole("link", {name: "View inventory"})).toHaveAttribute("href", "/inventory");
});
