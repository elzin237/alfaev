import { NavLink } from "react-router";

export default function ProductCalculatorNavigation() {
  return (
    <nav aria-label="Product Calculator" className="flex flex-wrap gap-2">
      <NavLink to="/pcb" end className={({ isActive }) =>
        `rounded-xl border px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 ${isActive
          ? "border-zinc-900 bg-zinc-900 text-white"
          : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"}`}>
        Calculator
      </NavLink>
      <NavLink to="/pcb/test" className={({ isActive }) =>
        `rounded-xl border px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${isActive
          ? "border-blue-700 bg-blue-700 text-white"
          : "border-blue-200 bg-white text-blue-800 hover:bg-blue-50"}`}>
        Test Calculator
      </NavLink>
    </nav>
  );
}
