import { describe, expect, it } from "vitest";
import { activeProblemBadge, getDashboardAlertCount } from "./dashboardAlertCount";

function query(active: bigint, projectUnread: bigint | undefined) {
  return { data: { exactValue: active, projectUnread, hasUnread: active > 0n,
    displayValue: active.toString() }, isError: false };
}

it.each([
  [undefined,null],['0',null],['1','1'],['99','99'],['100','99+'],['9007199254740993','99+'],
  ['-1',null],['01',null],['1.1',null],['NaN',null],['9'.repeat(101),null],
])('presents only an exact authoritative v2 active count %s', (value,expected)=>{
  expect(activeProblemBadge(value)).toBe(expected);
});

describe("shared Dashboard alert count", () => {
  it.each([
    [1n, 2n, "3"], [1n, 1n, "2"], [0n, 1n, "1"], [0n, 0n, null],
    [0n, 2n, "2"], [1n, 0n, "1"],
  ])("combines %s active shortages and %s unread Projects", (active, project, badge) => {
    expect(getDashboardAlertCount(query(active, project), true, true).badgeValue).toBe(badge);
  });

  it("adds bigint counts exactly and retains compact overflow display", () => {
    expect(getDashboardAlertCount(query(9007199254740993n, 2n), true, true)).toMatchObject({
      combinedCount: 9007199254740995n, badgeValue: "99+",
    });
  });

  it.each([{ isPending: true }, { isFetching: true }, { isError: true }])(
    "hides stale counts when query unavailable: %j", (state) => {
      expect(getDashboardAlertCount({ ...query(1n, 2n), ...state }, true, true).badgeValue).toBeNull();
    },
  );

  it("fails closed when either count or authorization is missing", () => {
    expect(getDashboardAlertCount(query(1n, undefined), true, true).badgeValue).toBeNull();
    expect(getDashboardAlertCount({ isError: false }, true, true).badgeValue).toBeNull();
    expect(getDashboardAlertCount(query(1n, 2n), true, false).badgeValue).toBeNull();
    expect(getDashboardAlertCount({ data: { ...query(1n, 2n).data, exactValue: null }, isError: false }, true, true).badgeValue).toBeNull();
  });

  it("preserves the legacy overflow-safe count contract with tracking OFF", () => {
    expect(getDashboardAlertCount({ data: { exactValue: null, displayValue: "99+", hasUnread: true }, isError: false }, false, true).badgeValue).toBe("99+");
  });
});
