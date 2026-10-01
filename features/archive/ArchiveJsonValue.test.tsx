import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import ArchiveJsonValue, { humanizeArchiveFieldName } from "./ArchiveJsonValue";

describe("ArchiveJsonValue", () => {
  it.each([
    [null, "Null"],
    ["literal text", "literal text"],
    [42, "42"],
    [true, "True"],
    [false, "False"],
  ] as const)("renders scalar JSON data safely", (value, expected) => {
    render(<ArchiveJsonValue value={value} />);
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("renders objects, nested objects, arrays, and friendly field labels", () => {
    const { container } = render(<ArchiveJsonValue value={{
      customer_name: "Alfa",
      nested_data: { start_date: "2026-10-01" },
      values: [1, "two", null],
    }} />);
    expect(screen.getByText("Customer Name")).toBeInTheDocument();
    expect(screen.getByText("Nested Data")).toBeInTheDocument();
    expect(screen.getByText("Start Date")).toBeInTheDocument();
    expect(screen.getByText("Values")).toBeInTheDocument();
    expect(screen.getByText("two")).toBeInTheDocument();
    expect(within(container).getByText("Null")).toBeInTheDocument();
  });

  it("renders markup-looking text literally without executable HTML or edit controls", () => {
    const { container } = render(
      <ArchiveJsonValue value={{ note: "<img src=x onerror=alert(1)>" }} />,
    );
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("humanizes snake_case without inventing values", () => {
    expect(humanizeArchiveFieldName("related_user_id")).toBe("Related User ID");
    expect(humanizeArchiveFieldName("customer_name")).toBe("Customer Name");
  });
});
