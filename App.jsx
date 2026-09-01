import { Routes, Route } from "react-router";

import AppLayout from "./app/layouts/AppLayout";
import LoginPage from "./pages/auth/LoginPage";

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/*" element={<AppLayout />} />
    </Routes>
  );
}

export default App;
