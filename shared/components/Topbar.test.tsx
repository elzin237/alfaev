import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const topbarMocks = vi.hoisted(() => ({
  clear: vi.fn(),
  navigate: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ clear: topbarMocks.clear }),
}));
vi.mock("react-router", () => ({
  useNavigate: () => topbarMocks.navigate,
}));
vi.mock("../../app/auth/authService", () => ({
  signOut: topbarMocks.signOut,
}));

import Topbar from "./Topbar";

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("Topbar", () => {
  it("renders the Dashboard heading", () => {
    const setSidebarOpen = vi.fn();

    render(<Topbar setSidebarOpen={setSidebarOpen} />);

    expect(
      screen.getByRole("heading", { name: "Dashboard" }),
    ).toBeInTheDocument();
  });

  it("signs out, clears protected query data, and redirects to login", async () => {
    topbarMocks.signOut.mockResolvedValue({ ok: true, value: undefined });

    render(<Topbar setSidebarOpen={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Odjava" }));

    await waitFor(() => {
      expect(topbarMocks.signOut).toHaveBeenCalledOnce();
      expect(topbarMocks.clear).toHaveBeenCalledOnce();
      expect(topbarMocks.navigate).toHaveBeenCalledWith("/login", {
        replace: true,
      });
    });
  });

  it("blocks duplicate logout clicks while sign-out is pending", async () => {
    let resolveSignOut:
      | ((result: { ok: true; value: undefined }) => void)
      | undefined;
    topbarMocks.signOut.mockReturnValue(
      new Promise((resolve) => {
        resolveSignOut = resolve;
      }),
    );

    render(<Topbar setSidebarOpen={vi.fn()} />);
    const logoutButton = screen.getByRole("button", { name: "Odjava" });

    fireEvent.click(logoutButton);
    fireEvent.click(logoutButton);

    expect(topbarMocks.signOut).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Odjava u toku..." }))
      .toBeDisabled();

    resolveSignOut?.({ ok: true, value: undefined });

    await waitFor(() => {
      expect(topbarMocks.clear).toHaveBeenCalledOnce();
      expect(topbarMocks.navigate).toHaveBeenCalledOnce();
    });
  });

  it("keeps the session context and cache in place when logout fails", async () => {
    topbarMocks.signOut.mockResolvedValue({
      ok: false,
      error: {
        code: "auth_request_failed",
        message: "The authentication request could not be completed.",
      },
    });

    render(<Topbar setSidebarOpen={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Odjava" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The authentication request could not be completed.",
    );
    expect(topbarMocks.clear).not.toHaveBeenCalled();
    expect(topbarMocks.navigate).not.toHaveBeenCalled();
  });
});
