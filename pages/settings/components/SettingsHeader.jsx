import { Save } from "lucide-react";

function SettingsHeader() {
  return (
    <header className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm lg:p-8">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="mb-2 text-sm font-semibold uppercase tracking-wider text-red-600">
            System Administration
          </p>

          <h1 className="text-3xl font-bold text-zinc-900 lg:text-4xl">
            Settings
          </h1>

          <p className="mt-2 text-zinc-500">
            Configure system preferences, company information and security
            settings.
          </p>
        </div>

        <button className="flex items-center justify-center gap-2 rounded-2xl bg-red-600 px-6 py-4 font-semibold text-white transition hover:bg-red-700">
          <Save size={18} />
          Save Changes
        </button>
      </div>
    </header>
  );
}

export default SettingsHeader;
