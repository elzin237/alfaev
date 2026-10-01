import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listAuditLogPage: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock("../../app/auth/AuthProvider", () => ({ useAuth: mocks.useAuth }));
vi.mock("./archiveService", async (importOriginal) => {
  const original = await importOriginal<typeof import("./archiveService")>();
  return { ...original, listAuditLogPage: mocks.listAuditLogPage };
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
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { ...render(<ArchivePage />, { wrapper }), client };
}

beforeEach(() => {
  mocks.useAuth.mockReturnValue({ profile: { id: "profile-1" } });
  mocks.listAuditLogPage.mockResolvedValue({ ok: true, value: [] });
});

afterEach(() => {
  cleanup();
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
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.queryByText(/before_data|after_data|metadata/i)).not.toBeInTheDocument();
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
});
