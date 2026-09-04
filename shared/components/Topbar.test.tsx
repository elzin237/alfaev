import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import Topbar from "./Topbar";

describe("Topbar", () => {
  it("renders the Dashboard heading", () => {
    const setSidebarOpen = vi.fn();

    render(<Topbar setSidebarOpen={setSidebarOpen} />);

    expect(
      screen.getByRole("heading", { name: "Dashboard" }),
    ).toBeInTheDocument();
  });
});
