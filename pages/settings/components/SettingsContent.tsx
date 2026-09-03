import type { SettingsSection } from "../../../lib/types/domain";

interface SettingsContentProps {
  activeSection: SettingsSection;
}

function SettingsContent({ activeSection }: SettingsContentProps) {
  const titles: Record<SettingsSection, string> = {
    general: "General Settings",
    company: "Company Settings",
    appearance: "Appearance Settings",
    security: "Security Settings",
    notifications: "Notification Settings",
  };

  const descriptions: Record<SettingsSection, string> = {
    general: "Manage core platform configuration and default system behavior.",
    company: "Configure company information and organizational details.",
    appearance: "Customize themes, colors and visual preferences.",
    security: "Manage authentication, sessions and security policies.",
    notifications: "Configure alerts, emails and system notifications.",
  };

  return (
    <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm lg:p-8">
      <div className="border-b border-zinc-200 pb-6">
        <h2 className="text-2xl font-bold text-zinc-900">
          {titles[activeSection]}
        </h2>

        <p className="mt-2 text-zinc-500">{descriptions[activeSection]}</p>
      </div>

      <div className="mt-8 grid gap-5 lg:grid-cols-2">
        <div className="rounded-2xl border border-zinc-200 p-5">
          <p className="text-sm font-medium text-zinc-500">Content Area</p>

          <p className="mt-2 text-lg font-semibold text-zinc-900">
            {titles[activeSection]}
          </p>
        </div>

        <div className="rounded-2xl border border-zinc-200 p-5">
          <p className="text-sm font-medium text-zinc-500">Status</p>

          <p className="mt-2 text-lg font-semibold text-zinc-900">
            Ready for configuration
          </p>
        </div>
      </div>
    </section>
  );
}

export default SettingsContent;
