import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import EmptyState from "./EmptyState";
import ErrorState from "./ErrorState";
import LoadingState from "./LoadingState";

afterEach(cleanup);

describe("shared UI states", () => {
  it("exposes visible loading status text", () => {
    render(<LoadingState message="Loading projects..." />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading projects...",
    );
  });

  it("does not render a retry action without a callback", () => {
    render(<ErrorState message="Projects could not be loaded." />);

    expect(
      screen.queryByRole("button", { name: "Try again" }),
    ).not.toBeInTheDocument();
  });

  it("invokes the configured retry action", () => {
    const onRetry = vi.fn();

    render(
      <ErrorState
        message="Projects could not be loaded."
        onRetry={onRetry}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("renders an empty-state action only when configured", () => {
    const onAction = vi.fn();
    const { rerender } = render(<EmptyState title="No projects yet" />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    rerender(
      <EmptyState
        title="No projects yet"
        action={{ label: "Create project", onClick: onAction }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    expect(onAction).toHaveBeenCalledOnce();
  });
});
