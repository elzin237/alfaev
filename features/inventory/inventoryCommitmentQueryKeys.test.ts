import { describe, expect, it } from "vitest";

import { inventoryCommitmentsQueryKey, productProjectCommitmentsQueryKey } from "./inventoryCommitmentQueryKeys";

describe("Inventory commitment query keys", () => {
  it("isolates Product totals and on-demand attribution by profile and Product", () => {
    expect(inventoryCommitmentsQueryKey("user-a")).toEqual(["inventory", "commitments", "user-a"]);
    expect(inventoryCommitmentsQueryKey("user-b")).not.toEqual(inventoryCommitmentsQueryKey("user-a"));
    expect(productProjectCommitmentsQueryKey("user-a", "product-1")).toEqual([
      "inventory", "commitments", "user-a", "product", "product-1",
    ]);
    expect(productProjectCommitmentsQueryKey("user-a", "product-2"))
      .not.toEqual(productProjectCommitmentsQueryKey("user-a", "product-1"));
  });
});
