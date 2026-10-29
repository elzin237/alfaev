import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import DashboardProjectDonut from "./DashboardProjectDonut";
afterEach(cleanup);

it("draws only actual nonzero statuses with proportions derived from the total", () => {
  render(<DashboardProjectDonut total={4} segments={[
    {label: "Planned", value: 3, color: "#0ea5e9"},
    {label: "Completed", value: 1, color: "#10b981"},
    {label: "Cancelled", value: 0, color: "#a1a1aa"},
  ]} />);
  const chart = screen.getByRole("img", {name: "Project status distribution based on 4 projects"});
  const arcs = chart.querySelectorAll("[data-project-segment]");
  expect(arcs).toHaveLength(2);
  expect(arcs[0]).toHaveAttribute("stroke-dasharray", "75 25");
  expect(arcs[1]).toHaveAttribute("stroke-dasharray", "25 75");
  expect(arcs[1]).toHaveAttribute("stroke-dashoffset", "-75");
});

it("shows a neutral ring without colored data arcs for an empty database", () => {
  render(<DashboardProjectDonut total={0} segments={[{label: "Planned", value: 0, color: "#0ea5e9"}]} />);
  expect(screen.getByRole("img").querySelectorAll("[data-project-segment]")).toHaveLength(0);
  expect(screen.getByText("0")).toBeInTheDocument();
});
