import { NavLink } from "react-router";
import { X } from "lucide-react";

import { NAVIGATION } from "../../lib/constants/navigation";

function Sidebar({ sidebarOpen, setSidebarOpen }) {
  return (
    <>
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`
          fixed left-0 top-0 z-50 h-screen w-72 bg-[#202225] text-white
          transition-transform duration-300
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
lg:relative lg:h-screen lg:translate-x-0        `}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-6">
          <div>
            <h1 className="text-2xl font-bold tracking-wide text-red-600">
              ALFAEV
            </h1>

            <p className="mt-1 text-sm text-zinc-400">
              Project & Production Hub
            </p>
          </div>

          <button onClick={() => setSidebarOpen(false)} className="lg:hidden">
            <X size={22} />
          </button>
        </div>

        <nav className="p-4">
          {NAVIGATION.map(({ label, path, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `mb-1 flex w-full items-center gap-3 rounded-xl px-4 py-3 transition ${
                  isActive
                    ? "bg-red-600 text-white"
                    : "text-zinc-300 hover:bg-white/5"
                }`
              }
            >
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
    </>
  );
}

export default Sidebar;
