import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getHeaderMetadata, HEADER_ROUTES } from "./headerMetadata";

describe("central application header route metadata", () => {
  it("covers every registered screen without adding placeholder routes", () => {
    const router = readFileSync("app/router/AppRouter.tsx", "utf8");
    const paths = [...router.matchAll(/\bpath="([^"]+)"/g)].map(m => m[1]).sort();
    expect(HEADER_ROUTES.map(r => r.path).sort()).toEqual(paths);
  });
  it.each(HEADER_ROUTES)("resolves direct navigation to $path", route => {
    const path = route.path.replace(/:[^/]+/g, "authorized-record");
    expect(getHeaderMetadata(path)).toEqual(route.handle);
    expect(route.handle.title).not.toBe("Dashboard");
    expect(route.handle.subtitle.trim()).not.toBe("");
  });
  it("preserves the approved Dashboard and Inventory copy", () => {
    expect(getHeaderMetadata("/")).toMatchObject({ title:"Operations Overview", subtitle:"From planning to production." });
    expect(getHeaderMetadata("/inventory/")).toMatchObject({ title:"Inventory", subtitle:"Materials and stock management." });
  });
  it("ranks static creation/Test routes ahead of parameterized details", () => {
    expect(getHeaderMetadata("/work-orders/new").title).toBe("New Work Order");
    expect(getHeaderMetadata("/pcb/test").title).toBe("Test Calculator");
    expect(getHeaderMetadata("/pcb/card/produce").title).toBe("Production Planning");
    expect(getHeaderMetadata("/work-orders/wo/pdf").title).toBe("Work Order Document");
  });
  it.each(["/unknown", "/projects/one/unknown", "/inventory-extra", "/settings", "/settings/security"])("fails safely for unregistered %s", path => {
    expect(getHeaderMetadata(path)).toEqual({ title:"AlfaEV", subtitle:"Choose an available page from the navigation." });
  });
});
