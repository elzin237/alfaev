import { useState } from "react";
import type { SettingsSection } from "../../lib/types/domain";

import SettingsHeader from "./components/SettingsHeader";
import SettingsSidebar from "./components/SettingsSidebar";
import SettingsContent from "./components/SettingsContent";

function SettingsPage() {
  const [activeSection, setActiveSection] =
    useState<SettingsSection>("general");

  return (
    <div className="space-y-6">
      <SettingsHeader />

      <div className="grid gap-6 xl:grid-cols-[280px_1fr]">
        <SettingsSidebar
          activeSection={activeSection}
          setActiveSection={setActiveSection}
        />

        <SettingsContent activeSection={activeSection} />
      </div>
    </div>
  );
}

export default SettingsPage;
