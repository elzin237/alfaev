import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useProjectActivityImage: vi.fn(),
  useProjectIssueResolutionImage: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock("../hooks/useProjectActivity", () => ({
  useProjectActivityImage: mocks.useProjectActivityImage,
  useProjectIssueResolutionImage: mocks.useProjectIssueResolutionImage,
}));

import ProjectActivityImage from "./ProjectActivityImage";

beforeEach(() => {
  mocks.useProjectActivityImage.mockReturnValue({
    isPending: false,
    isError: false,
    data: {
      signedUrl: "https://storage.example/image?token=signed",
      expiresIn: 300,
      mimeType: "image/png",
      byteSize: 42,
      altText: null,
    },
    refetch: mocks.refetch,
  });
  mocks.useProjectIssueResolutionImage.mockReturnValue({
    isPending: false,
    isError: false,
    data: {
      signedUrl: "https://storage.example/resolution?token=signed",
      expiresIn: 300,
      mimeType: "image/png",
      byteSize: 42,
      altText: "Resolution evidence",
    },
    refetch: mocks.refetch,
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetAllMocks(); });

describe("ProjectActivityImage", () => {
  it("uses the resolution-specific authorized signed-read hook for evidence", () => {
    render(
      <ProjectActivityImage
        projectId="00000000-0000-4000-8000-000000000001"
        activityId="00000000-0000-4000-8000-000000000002"
        resolutionId="00000000-0000-4000-8000-000000000003"
        title="Resolution evidence"
        altText="Evidence"
      />,
    );
    expect(mocks.useProjectActivityImage).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
      false,
    );
    expect(mocks.useProjectIssueResolutionImage).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
      "00000000-0000-4000-8000-000000000003",
      true,
    );
    expect(screen.getByRole("img", { name: "Resolution evidence" }))
      .toHaveAttribute("src", "https://storage.example/resolution?token=signed");
  });

  it("uses title fallback, opens an accessible viewer, traps focus, and closes on Escape", async () => {
    render(
      <ProjectActivityImage
        projectId="00000000-0000-4000-8000-000000000001"
        activityId="00000000-0000-4000-8000-000000000002"
        title="Site image"
        altText={null}
      />,
    );
    const open = screen.getByRole("button", { name: "Open image for Site image" });
    expect(open.parentElement).toHaveClass("w-full", "max-w-[300px]");
    expect(open).toHaveClass("w-full", "rounded-xl");
    const thumbnail = screen.getByRole("img", { name: "Site image" });
    expect(thumbnail).toHaveClass(
      "aspect-[30/19]",
      "max-h-[190px]",
      "w-full",
      "object-cover",
    );
    expect(thumbnail).toHaveAttribute(
      "referrerpolicy",
      "no-referrer",
    );
    fireEvent.click(open);
    const dialog = screen.getByRole("dialog", { name: "Site image" });
    expect(dialog.parentElement).toHaveClass("fixed", "inset-0", "z-50");
    const close = screen.getByRole("button", { name: "Close image viewer" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getAllByRole("img", { name: "Site image" })[1])
      .toHaveClass("object-contain");
    expect(close).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(open).toHaveFocus();
  });

  it("keeps signed access visibility-gated inside a nested scroll region", async () => {
    let intersectionCallback: IntersectionObserverCallback | null = null;
    const observe = vi.fn();
    const disconnect = vi.fn();
    class IntersectionObserverMock {
      readonly root = null;
      readonly rootMargin = "160px";
      readonly thresholds = [0];
      observe = observe;
      disconnect = disconnect;
      unobserve = vi.fn();
      takeRecords = vi.fn(() => []);

      constructor(
        callback: IntersectionObserverCallback,
        options?: IntersectionObserverInit,
      ) {
        intersectionCallback = callback;
        expect(options).toEqual({ rootMargin: "160px" });
      }
    }
    vi.stubGlobal("IntersectionObserver", IntersectionObserverMock);

    render(
      <div className="max-h-[42rem] overflow-y-auto">
        <ProjectActivityImage
          projectId="00000000-0000-4000-8000-000000000001"
          activityId="00000000-0000-4000-8000-000000000002"
          title="Nested image"
          altText={null}
        />
      </div>,
    );

    expect(mocks.useProjectActivityImage).toHaveBeenLastCalledWith(
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
      false,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Loading image");
    expect(observe).toHaveBeenCalledOnce();

    act(() => {
      intersectionCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    await waitFor(() => expect(mocks.useProjectActivityImage)
      .toHaveBeenLastCalledWith(
        "00000000-0000-4000-8000-000000000001",
        "00000000-0000-4000-8000-000000000002",
        true,
      ));
    expect(screen.getByRole("button", { name: "Open image for Nested image" }))
      .toBeInTheDocument();
    expect(disconnect).toHaveBeenCalled();
  });

  it("offers bounded manual signed-URL renewal after an image error", async () => {
    render(
      <ProjectActivityImage
        projectId="00000000-0000-4000-8000-000000000001"
        activityId="00000000-0000-4000-8000-000000000002"
        title="Site image"
        altText="Panel detail"
      />,
    );
    fireEvent.error(screen.getByRole("img", { name: "Panel detail" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be loaded");
    expect(mocks.refetch).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Try image again" }));
    expect(mocks.refetch).toHaveBeenCalledTimes(2);
  });
});
