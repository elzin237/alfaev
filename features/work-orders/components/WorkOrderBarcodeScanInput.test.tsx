import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import WorkOrderBarcodeScanInput from "./WorkOrderBarcodeScanInput";

afterEach(() => cleanup());

describe("WorkOrderBarcodeScanInput", () => {
  it("captures one exact seven-digit Serial on Enter, clears, and retains focus", () => {
    const onScan = vi.fn();
    render(<WorkOrderBarcodeScanInput onScan={onScan} />);
    const input = screen.getByRole("textbox", { name: "Scan Product Barcode" });
    input.focus();
    fireEvent.change(input, { target: { value: "0000123" } });

    expect(fireEvent.keyDown(input, { key: "Enter", code: "Enter" })).toBe(false);

    expect(onScan).toHaveBeenCalledExactlyOnceWith("0000123");
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("supports normal keyboard entry without submitting at seven digits", () => {
    const onScan = vi.fn();
    render(<WorkOrderBarcodeScanInput onScan={onScan} />);
    const input = screen.getByRole("textbox", { name: "Scan Product Barcode" });

    fireEvent.change(input, { target: { value: "1234567" } });

    expect(input).toHaveValue("1234567");
    expect(onScan).not.toHaveBeenCalled();
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(input).toHaveAttribute("maxlength", "7");
    expect(input).toHaveAttribute("autocomplete", "off");
  });

  it.each(["123456", "12345A7", " 000123", "１２３４５６７"])(
    "rejects invalid input %s without clearing or capturing it",
    (value) => {
      const onScan = vi.fn();
      render(<WorkOrderBarcodeScanInput onScan={onScan} />);
      const input = screen.getByRole("textbox", {
        name: "Scan Product Barcode",
      });
      fireEvent.change(input, { target: { value } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

      expect(onScan).not.toHaveBeenCalled();
      expect(input).toHaveValue(value);
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Enter a 7-digit Serial Number.",
      );
    },
  );

  it("clears a prior format error after a corrected successful scan", () => {
    const onScan = vi.fn();
    render(<WorkOrderBarcodeScanInput onScan={onScan} />);
    const input = screen.getByRole("textbox", { name: "Scan Product Barcode" });
    fireEvent.change(input, { target: { value: "123" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    expect(screen.getByRole("alert")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "7654321" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    expect(onScan).toHaveBeenCalledExactlyOnceWith("7654321");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not submit an enclosing form when scanner Enter is handled", () => {
    const onScan = vi.fn();
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <WorkOrderBarcodeScanInput onScan={onScan} />
      </form>,
    );
    const input = screen.getByRole("textbox", { name: "Scan Product Barcode" });
    fireEvent.change(input, { target: { value: "0000001" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    expect(onScan).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("can be disabled without installing any global capture behavior", () => {
    const onScan = vi.fn();
    render(<WorkOrderBarcodeScanInput disabled onScan={onScan} />);
    const input = screen.getByRole("textbox", { name: "Scan Product Barcode" });

    expect(input).toBeDisabled();
    fireEvent.keyDown(document.body, { key: "Enter", code: "Enter" });
    expect(onScan).not.toHaveBeenCalled();
  });

  it("refocuses after an asynchronous resolution re-enables the scanner", () => {
    const onScan = vi.fn();
    const view = render(
      <WorkOrderBarcodeScanInput disabled onScan={onScan} />,
    );
    const disabledInput = screen.getByRole("textbox", {
      name: "Scan Product Barcode",
    });
    expect(disabledInput).toBeDisabled();

    view.rerender(<WorkOrderBarcodeScanInput onScan={onScan} />);

    expect(screen.getByRole("textbox", { name: "Scan Product Barcode" }))
      .toHaveFocus();
  });
});
