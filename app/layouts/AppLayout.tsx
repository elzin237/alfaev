import { useState } from "react";

import AppRouter from "../router/AppRouter";
import Topbar from "../../shared/components/Topbar";
import Sidebar from "../navigation/Sidebar";

function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-[#f4f5f7]">
      <Sidebar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar setSidebarOpen={setSidebarOpen} />

        <main className="flex-1 overflow-y-auto p-4 lg:p-8">
          <AppRouter />
        </main>
      </div>
    </div>
  );
}

export default AppLayout;
