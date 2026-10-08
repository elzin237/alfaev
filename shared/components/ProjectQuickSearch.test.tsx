import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const quickSearchMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  useProjectSearch: vi.fn(),
}));

vi.mock("react-router", () => ({
  useNavigate: () => quickSearchMocks.navigate,
}));
vi.mock("../../features/projects/hooks/useProjectSearch", () => ({
  useProjectSearch: quickSearchMocks.useProjectSearch,
}));

import ProjectQuickSearch from "./ProjectQuickSearch";

const results = [
  {
    projectId: "00000000-0000-4000-8000-000000000001",
    name: "Alpha Project",
    status: "planned",
  },
  {
    projectId: "00000000-0000-4000-8000-000000000002",
    name: "Beta Alpha Project",
    status: "in_progress",
  },
];

function settleDebounce(): void {
  act(() => vi.advanceTimersByTime(200));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  quickSearchMocks.useProjectSearch.mockReturnValue({
    data: { ok: true, value: results },
    isError: false,
    isPending: false,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ProjectQuickSearch", () => {
  it("keeps an empty query closed and forwards the debounced normalized query", () => {
    render(<ProjectQuickSearch enabled />);
    const input = screen.getByRole("combobox", { name: "Search projects" });

    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(quickSearchMocks.useProjectSearch).toHaveBeenLastCalledWith("", true);

    fireEvent.change(input, { target: { value: "  Alpha  " } });
    expect(screen.getByRole("status")).toHaveTextContent("Searching Projects...");
    settleDebounce();

    expect(quickSearchMocks.useProjectSearch)
      .toHaveBeenLastCalledWith("Alpha", true);
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  it("renders loading, no-results, and safe error states", () => {
    quickSearchMocks.useProjectSearch.mockReturnValue({
      data: undefined,
      isError: false,
      isPending: true,
    });
    const { rerender } = render(<ProjectQuickSearch enabled />);
    const input = screen.getByRole("combobox", { name: "Search projects" });
    fireEvent.change(input, { target: { value: "Alpha" } });
    settleDebounce();
    expect(screen.getByRole("status")).toHaveTextContent("Searching Projects...");

    quickSearchMocks.useProjectSearch.mockReturnValue({
      data: { ok: true, value: [] },
      isError: false,
      isPending: false,
    });
    rerender(<ProjectQuickSearch enabled />);
    expect(screen.getByRole("status")).toHaveTextContent("No matching Projects.");

    quickSearchMocks.useProjectSearch.mockReturnValue({
      data: {
        ok: false,
        error: {
          code: "project_search_failed",
          message: "raw provider details",
        },
      },
      isError: false,
      isPending: false,
    });
    rerender(<ProjectQuickSearch enabled />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Projects could not be searched.",
    );
    expect(screen.queryByText("raw provider details")).not.toBeInTheDocument();
  });

  it("supports ArrowDown, ArrowUp, Enter, and Escape from the combobox", () => {
    render(<ProjectQuickSearch enabled />);
    const input = screen.getByRole("combobox", { name: "Search projects" });
    fireEvent.change(input, { target: { value: "Alpha" } });
    settleDebounce();

    expect(screen.getAllByRole("option")[0]).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1]).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(screen.getAllByRole("option")[0]).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.keyDown(input, { key: "Enter" });
    expect(quickSearchMocks.navigate).toHaveBeenCalledWith(
      "/projects/00000000-0000-4000-8000-000000000001",
    );
    expect(input).toHaveValue("");
    expect(input).toHaveAttribute("aria-expanded", "false");

    fireEvent.change(input, { target: { value: "Beta" } });
    settleDebounce();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("navigates by mouse selection and closes when the query is cleared", () => {
    render(<ProjectQuickSearch enabled />);
    const input = screen.getByRole("combobox", { name: "Search projects" });
    fireEvent.change(input, { target: { value: "Alpha" } });
    settleDebounce();
    fireEvent.click(screen.getByRole("option", { name: /Beta Alpha Project/i }));

    expect(quickSearchMocks.navigate).toHaveBeenCalledWith(
      "/projects/00000000-0000-4000-8000-000000000002",
    );
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "Alpha" } });
    settleDebounce();
    fireEvent.change(input, { target: { value: "" } });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
