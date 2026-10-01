import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuditLogDetail: vi.fn(),
  getAuditLogFilterOptions: vi.fn(),
  listAuditLogPage: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock("../../app/auth/AuthProvider", () => ({ useAuth: mocks.useAuth }));
vi.mock("./archiveService", async (importOriginal) => {
  const original = await importOriginal<typeof import("./archiveService")>();
  return {
    ...original,
    getAuditLogDetail: mocks.getAuditLogDetail,
    getAuditLogFilterOptions: mocks.getAuditLogFilterOptions,
    listAuditLogPage: mocks.listAuditLogPage,
  };
});

import ArchivePage from "./ArchivePage";
import type { ArchiveAuditLogItem } from "./archiveService";

function item(index: number, overrides: Partial<ArchiveAuditLogItem> = {}): ArchiveAuditLogItem {
  return {
    auditLogId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    actorUserId: "00000000-0000-4000-8000-000000000099",
    actorFullName: "Historical Actor",
    actionType: "calendar.created",
    entityType: "calendar_entry",
    entityId: "12345678-1234-4234-8234-123456789abc",
    summary: `Exact summary ${index}`,
    createdAt: `2026-10-01T10:${String(index % 60).padStart(2, "0")}:00.000Z`,
    ...overrides,
  };
}

function renderArchive() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return { ...render(<ArchivePage />, { wrapper }), client };
}

beforeEach(() => {
  mocks.useAuth.mockReturnValue({ profile: { id: "profile-1" } });
  mocks.listAuditLogPage.mockResolvedValue({ ok: true, value: [] });
  mocks.getAuditLogFilterOptions.mockResolvedValue({
    ok: true,
    value: {
      actors: [{
        userId: "00000000-0000-4000-8000-000000000099",
        fullName: "Historical Actor",
      }],
      entityTypes: ["calendar_entry", "future_quality_gate"],
      actionTypes: ["calendar.created", "future.bulk_reconciled"],
    },
  });
  mocks.getAuditLogDetail.mockResolvedValue({
    ok: false,
    error: { code: "archive_detail_failed", message: "Safe" },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe("ArchivePage", () => {
  it("renders its header and initial loading without a fake empty state", () => {
    mocks.listAuditLogPage.mockReturnValue(new Promise(() => undefined));
    renderArchive();

    expect(screen.getByRole("heading", { name: "Archive" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading Archive activity...");
    expect(screen.queryByText("No audit activity yet.")).not.toBeInTheDocument();
  });

  it("renders a retryable initial error distinctly from an empty result", async () => {
    mocks.listAuditLogPage.mockResolvedValueOnce({
      ok: false,
      error: { code: "archive_page_failed", message: "Safe service message" },
    }).mockResolvedValueOnce({ ok: true, value: [] });
    renderArchive();

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load Archive");
    expect(screen.queryByText("No audit activity yet.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "No audit activity yet." }))
      .toBeInTheDocument();
  });

  it("renders the honest read-only empty state", async () => {
    renderArchive();
    expect(await screen.findByRole("heading", { name: "No audit activity yet." }))
      .toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders the exact six columns and list-safe formatting in server order", async () => {
    const rows = [
      item(1),
      item(2, {
        actorFullName: "Inactive Historical Actor",
        actionType: "future.bulk_reconciled",
        entityType: "future_quality_gate",
        entityId: null,
        summary: "Summary remains EXACT — including punctuation.",
      }),
    ];
    mocks.listAuditLogPage.mockResolvedValue({ ok: true, value: rows });
    const { container } = renderArchive();

    const table = await screen.findByRole("table");
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent))
      .toEqual(["Date/Time", "User", "Module", "Action", "Record", "Summary"]);
    expect(within(table).getAllByRole("row").slice(1).map((row) => row.textContent))
      .toEqual(expect.arrayContaining([
        expect.stringContaining("Exact summary 1"),
        expect.stringContaining("Summary remains EXACT — including punctuation."),
      ]));
    expect(within(table).getAllByRole("row")[1]).toHaveTextContent("Historical Actor");
    expect(within(table).getAllByRole("row")[1]).toHaveTextContent("Calendar");
    expect(within(table).getAllByRole("row")[1]).toHaveTextContent("Created");
    expect(screen.getByLabelText(`Record ${rows[0]!.entityId}`))
      .toHaveAttribute("title", rows[0]!.entityId);
    expect(screen.getByText("12345678…9abc")).toBeInTheDocument();
    expect(within(table).getAllByRole("row")[2]).toHaveTextContent("Future Quality Gate");
    expect(within(table).getAllByRole("row")[2]).toHaveTextContent("Bulk Reconciled");
    expect(within(table).getAllByRole("row")[2]).toHaveTextContent("—");
    expect(container.querySelector(`time[datetime="${rows[0]!.createdAt}"]`))
      .toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create|edit|delete|restore/i }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search" })).toBeInTheDocument();
    expect(screen.queryByText(/before_data|after_data|metadata/i)).not.toBeInTheDocument();
  });

  it("renders accessible filters, friendly options, clear state, and active count", async () => {
    renderArchive();
    await waitFor(() => expect(screen.getByLabelText("User")).toBeEnabled());
    expect(screen.getByLabelText("Search")).toBeInTheDocument();
    expect(screen.getByLabelText("From")).toHaveAttribute("type", "date");
    expect(screen.getByLabelText("To")).toHaveAttribute("type", "date");
    expect(screen.getByLabelText("Module")).toContainHTML("Calendar");
    expect(screen.getByLabelText("Module")).toContainHTML("Future Quality Gate");
    expect(screen.getByLabelText("Action")).toContainHTML("Created");
    expect(screen.getByLabelText("Action")).toContainHTML("Bulk Reconciled");
    expect(screen.getByText("No active filters")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("User"), {
      target: { value: "00000000-0000-4000-8000-000000000099" },
    });
    fireEvent.change(screen.getByLabelText("Module"), {
      target: { value: "calendar_entry" },
    });
    expect(screen.getByText("3 active filters")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeEnabled();
  });

  it("debounces search, hides stale rows while settling, and clear neutralizes stale timers", async () => {
    mocks.listAuditLogPage.mockResolvedValue({ ok: true, value: [item(1)] });
    renderArchive();
    expect(await screen.findByText("Exact summary 1")).toBeInTheDocument();
    vi.useFakeTimers();

    fireEvent.change(screen.getByLabelText("Search"), {
      target: { value: "  calendar  " },
    });
    expect(screen.getByRole("status")).toHaveTextContent("Applying Archive filters...");
    expect(screen.queryByText("Exact summary 1")).not.toBeInTheDocument();
    expect(mocks.listAuditLogPage).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(299));
    expect(mocks.listAuditLogPage).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(1); await Promise.resolve(); });
    expect(mocks.listAuditLogPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ searchText: "calendar" }),
      null,
    );

    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "stale" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByLabelText("Search")).toHaveValue("");
    expect(mocks.listAuditLogPage).not.toHaveBeenCalledWith(
      expect.objectContaining({ searchText: "stale" }),
      expect.anything(),
    );
    vi.useRealTimers();
  });

  it("composes selects and dates into a new first-page request and shows filtered empty state", async () => {
    renderArchive();
    await waitFor(() => expect(screen.getByLabelText("User")).toBeEnabled());
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-01-15" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-01-16" } });
    fireEvent.change(screen.getByLabelText("User"), {
      target: { value: "00000000-0000-4000-8000-000000000099" },
    });
    fireEvent.change(screen.getByLabelText("Module"), {
      target: { value: "calendar_entry" },
    });
    fireEvent.change(screen.getByLabelText("Action"), {
      target: { value: "calendar.created" },
    });
    expect(await screen.findByRole("heading", {
      name: "No audit activity matches these filters.",
    })).toBeInTheDocument();
    expect(mocks.listAuditLogPage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        createdFrom: expect.stringMatching(/^2026-01-1[45]T/),
        createdBefore: expect.stringMatching(/^2026-01-1[67]T/),
        actorUserId: "00000000-0000-4000-8000-000000000099",
        entityType: "calendar_entry",
        actionType: "calendar.created",
      }),
      null,
    );
    const callsBeforeClear = mocks.listAuditLogPage.mock.calls.length;
    fireEvent.click(screen.getAllByRole("button", { name: "Clear filters" })[0]!);
    expect(screen.getByText("No active filters")).toBeInTheDocument();
    await waitFor(() => {
      expect(mocks.listAuditLogPage.mock.calls.length).toBeGreaterThan(callsBeforeClear);
      expect(mocks.listAuditLogPage).toHaveBeenLastCalledWith(
        {
          createdFrom: null,
          createdBefore: null,
          actorUserId: null,
          entityType: null,
          actionType: null,
          searchText: null,
        },
        null,
      );
    });
  });

  it("keeps list loading separate from a retryable filter-options failure", async () => {
    mocks.getAuditLogFilterOptions
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "archive_filter_options_failed", message: "Safe" },
      })
      .mockResolvedValueOnce({ ok: true, value: {
        actors: [], entityTypes: [], actionTypes: [],
      } });
    renderArchive();
    expect(await screen.findByRole("heading", { name: "No audit activity yet." }))
      .toBeInTheDocument();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Archive filter options could not be loaded.");
    expect(screen.getByLabelText("User")).toBeDisabled();
    fireEvent.click(within(alert).getByRole("button", { name: "Retry filter options" }));
    await waitFor(() => expect(screen.getByLabelText("User")).toBeEnabled());
  });

  it("loads and appends a continuation while preserving the first page", async () => {
    const first = Array.from({ length: 50 }, (_, index) => item(index));
    let resolveNext: ((value: { ok: true; value: ArchiveAuditLogItem[] }) => void) | undefined;
    mocks.listAuditLogPage
      .mockResolvedValueOnce({ ok: true, value: first })
      .mockReturnValueOnce(new Promise((resolve) => { resolveNext = resolve; }));
    renderArchive();

    const button = await screen.findByRole("button", { name: "Load more" });
    fireEvent.click(button);
    expect(screen.getByText("Exact summary 0")).toBeInTheDocument();
    const pendingButton = await screen.findByRole("button", { name: "Loading more..." });
    fireEvent.click(pendingButton);
    expect(pendingButton).toBeDisabled();
    expect(mocks.listAuditLogPage).toHaveBeenCalledTimes(2);

    resolveNext?.({ ok: true, value: [item(51)] });
    expect(await screen.findByText("Exact summary 51")).toBeInTheDocument();
    expect(screen.getByText("Exact summary 0")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("keeps loaded rows on pagination failure and retries the same continuation", async () => {
    const first = Array.from({ length: 50 }, (_, index) => item(index));
    mocks.listAuditLogPage
      .mockResolvedValueOnce({ ok: true, value: first })
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "archive_page_failed", message: "Safe" },
      })
      .mockResolvedValueOnce({ ok: true, value: [] });
    renderArchive();

    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("More Archive activity could not be loaded.");
    expect(screen.getByText("Exact summary 0")).toBeInTheDocument();
    fireEvent.click(within(alert).getByRole("button", { name: "Retry load more" }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Load more" }))
        .not.toBeInTheDocument();
    });
    expect(screen.getByText("Exact summary 0")).toBeInTheDocument();
    expect(mocks.listAuditLogPage).toHaveBeenCalledTimes(3);
  });

  it("fetches detail lazily, renders safe JSON, and links only server-approved context", async () => {
    const row = item(1, { entityType: "project", actionType: "project.updated" });
    mocks.listAuditLogPage.mockResolvedValue({ ok: true, value: [row] });
    let resolveDetail: ((value: unknown) => void) | undefined;
    mocks.getAuditLogDetail.mockReturnValue(new Promise((resolve) => {
      resolveDetail = resolve;
    }));
    renderArchive();
    expect(await screen.findByText(row.summary)).toBeInTheDocument();
    expect(mocks.getAuditLogDetail).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("row", { name: `Open Archive detail: ${row.summary}` }));
    expect(screen.getByRole("dialog", { name: "Archive detail" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading Archive detail...");
    expect(mocks.getAuditLogDetail).toHaveBeenCalledExactlyOnceWith(row.auditLogId);

    resolveDetail?.({ ok: true, value: {
      ...row,
      beforeData: { customer_name: "Old customer" },
      afterData: { customer_name: "New customer" },
      metadata: { source: "trusted" },
      detailAuthorized: true,
      targetViewAuthorized: true,
      contextKind: "project",
      contextId: row.entityId,
    } });
    expect(await screen.findByText("Before")).toBeInTheDocument();
    expect(screen.getByText("After")).toBeInTheDocument();
    expect(screen.getByText("Metadata")).toBeInTheDocument();
    expect(screen.getAllByText("Customer Name")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Open record" }))
      .toHaveAttribute("href", `/projects/${row.entityId}`);
    expect(screen.queryByRole("button", { name: /edit|delete|restore/i }))
      .not.toBeInTheDocument();
  });

  it("shows restricted detail without JSON or context navigation", async () => {
    const row = item(2, { entityType: "user_profile" });
    mocks.listAuditLogPage.mockResolvedValue({ ok: true, value: [row] });
    mocks.getAuditLogDetail.mockResolvedValue({ ok: true, value: {
      ...row,
      beforeData: null,
      afterData: null,
      metadata: null,
      detailAuthorized: false,
      targetViewAuthorized: false,
      contextKind: null,
      contextId: null,
    } });
    renderArchive();
    fireEvent.keyDown(await screen.findByRole("row", {
      name: `Open Archive detail: ${row.summary}`,
    }), { key: "Enter" });
    expect(await screen.findByText("Additional details are restricted for this record."))
      .toBeInTheDocument();
    expect(screen.queryByText("Before")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open record" })).not.toBeInTheDocument();
  });

  it("keeps the list and filters intact when detail closes and retries detail separately", async () => {
    const row = item(3);
    mocks.listAuditLogPage.mockResolvedValue({ ok: true, value: [row] });
    mocks.getAuditLogDetail
      .mockResolvedValueOnce({ ok: false, error: {
        code: "archive_detail_failed", message: "Safe",
      } })
      .mockResolvedValueOnce({ ok: true, value: {
        ...row,
        beforeData: null,
        afterData: null,
        metadata: null,
        detailAuthorized: true,
        targetViewAuthorized: false,
        contextKind: null,
        contextId: null,
      } });
    renderArchive();
    await waitFor(() => expect(screen.getByLabelText("User")).toBeEnabled());
    fireEvent.change(screen.getByLabelText("User"), {
      target: { value: "00000000-0000-4000-8000-000000000099" },
    });
    fireEvent.click(await screen.findByRole("row", {
      name: `Open Archive detail: ${row.summary}`,
    }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Archive detail could not be loaded.");
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No additional audit detail was recorded."))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("User"))
      .toHaveValue("00000000-0000-4000-8000-000000000099");
    expect(screen.getByText(row.summary)).toBeInTheDocument();
  });
});
