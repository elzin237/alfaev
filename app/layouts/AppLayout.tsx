import { useRef, useState } from "react";

import AppRouter from "../router/AppRouter";
import Topbar from "../../shared/components/Topbar";
import Sidebar from "../navigation/Sidebar";
import ProjectAlertRuntimeSync from "../../features/dashboard/ProjectAlertRuntimeSync";

function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sidebarToggleRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="flex min-h-screen min-h-dvh bg-[#f4f5f7]">
      <ProjectAlertRuntimeSync />
      <Sidebar
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        returnFocusRef={sidebarToggleRef}
      />

      <div className="flex min-h-screen min-h-dvh min-w-0 flex-1 flex-col">
        <Topbar
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
          sidebarToggleRef={sidebarToggleRef}
        />

        <main className="flex-1 p-4 lg:p-8">
          <AppRouter />
        </main>
      </div>
    </div>
  );
}

export default AppLayout;
