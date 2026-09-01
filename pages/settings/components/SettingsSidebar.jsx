import { SETTINGS_SECTIONS } from "../data/settingsSections";

function SettingsSidebar({ activeSection, setActiveSection }) {
  return (
    <aside className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="mb-4 px-3 pt-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Configuration
        </h2>
      </div>

      <nav className="space-y-1">
        {SETTINGS_SECTIONS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveSection(id)}
            className={`flex w-full items-center gap-3 rounded-2xl px-4 py-4 text-left transition ${
              activeSection === id
                ? "bg-red-600 text-white"
                : "text-zinc-700 hover:bg-zinc-100"
            }`}
          >
            <Icon size={18} />
            <span className="font-medium">{label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}

export default SettingsSidebar;
