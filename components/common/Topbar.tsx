import { Bell, Menu, Search, UserCircle2 } from "lucide-react";

interface TopbarProps {
  setSidebarOpen: (open: boolean) => void;
}

function Topbar({ setSidebarOpen }: TopbarProps) {
  return (
    <header className="flex h-20 items-center justify-between border-b border-zinc-200 bg-white px-4 lg:px-8">
      <div className="flex items-center gap-4">
        <button
          onClick={() => setSidebarOpen(true)}
          className="flex h-11 w-11 items-center justify-center rounded-xl border border-zinc-200 lg:hidden"
        >
          <Menu size={20} />
        </button>

        <div>
          <h2 className="text-xl font-semibold text-zinc-900 lg:text-2xl">
            Dashboard
          </h2>

          <p className="hidden text-sm text-zinc-500 sm:block">
            Dobrodošli u ALFAEV sistem
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 lg:gap-4">
        <div className="hidden h-11 w-80 items-center gap-2 rounded-xl border border-zinc-200 px-4 lg:flex">
          <Search size={18} className="text-zinc-400" />

          <input
            type="text"
            placeholder="Pretraga projekata..."
            className="w-full outline-none"
          />
        </div>

        <button className="flex h-11 w-11 items-center justify-center rounded-xl border border-zinc-200">
          <Bell size={18} />
        </button>

        <button className="flex items-center gap-2 rounded-xl border border-zinc-200 px-3 py-2">
          <UserCircle2 size={22} />
          <span className="hidden text-sm font-medium sm:block">Admin</span>
        </button>
      </div>
    </header>
  );
}

export default Topbar;
