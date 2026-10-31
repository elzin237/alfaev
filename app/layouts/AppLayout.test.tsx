import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../../shared/components/ApplicationHeaderContext", () => ({
  ApplicationHeaderProvider: ({ children }: { children: import("react").ReactNode }) => <>{children}</>,
}));

vi.mock("../router/AppRouter", () => ({
  default: () => <section>Current page</section>,
}));
vi.mock("../../shared/components/Topbar", () => ({
  default: () => <header>Topbar</header>,
}));
vi.mock("../navigation/Sidebar", () => ({
  default: () => <aside>Sidebar</aside>,
}));
vi.mock("../../features/dashboard/ProjectAlertRuntimeSync", () => ({
  default: () => <span data-testid="project-alert-runtime-sync" />,
}));

import AppLayout from "./AppLayout";

afterEach(cleanup);

describe("AppLayout height contract", () => {
  it("mounts the Project alert runtime sync once in the persistent app shell", () => {
    render(<AppLayout />);
    expect(screen.getAllByTestId("project-alert-runtime-sync")).toHaveLength(1);
  });

  it("fills the viewport while allowing the page and main content to grow", () => {
    const { container } = render(<AppLayout />);
    const shell = container.firstElementChild;
    const main = screen.getByRole("main");
    const contentColumn = main.parentElement;

    expect(shell).toHaveClass(
      "flex",
      "min-h-screen",
      "min-h-dvh",
      "bg-[#f4f5f7]",
    );
    expect(shell).not.toHaveClass("h-screen", "overflow-hidden");
    expect(contentColumn).toHaveClass(
      "min-h-screen",
      "min-h-dvh",
      "flex-1",
      "flex-col",
    );
    expect(main).toHaveClass("flex-1");
    expect(main).not.toHaveClass("overflow-y-auto");
  });

  it("gives the document root a modern viewport minimum and canonical background", () => {
    const globalCss = readFileSync("styles/index.css", "utf8");

    expect(globalCss).toMatch(/html\s*\{[^}]*min-height:\s*100%/s);
    expect(globalCss).toMatch(
      /body,\s*#root\s*\{[^}]*min-height:\s*100vh;[^}]*min-height:\s*100dvh;/s,
    );
    expect(globalCss).toMatch(
      /body\s*\{[^}]*background-color:\s*#f4f5f7;/s,
    );
  });
});
