import PageHeader from "../../shared/components/PageHeader";
import ProductCalculatorNavigation from "../pcb/components/ProductCalculatorNavigation";
import TestCalculationHistory from "./components/TestCalculationHistory";
import TestCalculationEditor from "./components/TestCalculationEditor";
import { useState } from "react";
import { useTestCalculatorAccess } from "./hooks/useTestCalculatorAccess";
import ErrorState from "../../shared/components/ErrorState";
import LoadingState from "../../shared/components/LoadingState";

function ActivatedPage() {
  const access = useTestCalculatorAccess(true);
  if (access.isLoading) return <LoadingState message="Checking your access..." />;
  if (!access.canView) return <ErrorState title="Access denied" message="Test Calculator view permission is required." />;
  return <ActiveWorkspace key={access.scope} canManage={access.canManage} />;
}
function ActiveWorkspace({ canManage }: { canManage: boolean }) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editorVersion, setEditorVersion] = useState(0);
  return <div className="space-y-6">
    <ProductCalculatorNavigation />
    <div className="rounded-3xl border-t-4 border-blue-600 bg-blue-50 p-1">
      <PageHeader title="Test Calculator" description="Preview components and save immutable, time-limited Test Calculations. No physical stock is consumed."
        actions={<button type="button" disabled={!canManage || editorOpen} onClick={() => setEditorOpen(true)} className="w-full rounded-xl bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:bg-blue-100 disabled:text-blue-800 sm:w-auto">Create Test Calculation</button>} />
    </div>
    {!canManage && <p className="text-sm text-zinc-600">Shared history is available. Creation requires Test Calculator manage permission and the applicable warehouse views.</p>}
    {canManage && editorOpen && <TestCalculationEditor key={editorVersion} searchEnabledAfterActivation previewEnabledAfterActivation saveEnabledAfterActivation onSaved={() => setSaved(true)} />}
    {canManage && saved && <button type="button" className="rounded-xl border border-blue-700 px-4 py-2 font-semibold text-blue-900"
      onClick={() => { setSaved(false); setEditorVersion(v => v + 1); }}>Create another Test Calculation</button>}
    <TestCalculationHistory enabledAfterActivation />
  </div>;
}

// The closed route gate must remain in place until
// coordinated Test permission registration and backend/frontend activation review.
export default function TestCalculatorPage({enabledAfterActivation=false}:{enabledAfterActivation?:boolean}) {
  if (enabledAfterActivation) return <ActivatedPage />;
  return (
    <div className="space-y-6">
      <ProductCalculatorNavigation />
      <div className="rounded-3xl border-t-4 border-blue-600 bg-blue-50 p-1">
        <PageHeader title="Test Calculator"
          description="Preview component availability and plan time-limited Test Calculations separately from Calculator."
          actions={<button type="button" disabled aria-describedby="test-calculator-stage"
            className="w-full rounded-xl bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-blue-100 disabled:text-blue-800 sm:w-auto">
            Create Test Calculation
          </button>} />
      </div>
      <p id="test-calculator-stage" role="status" className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-900">
        Test Calculator is not activated. Creation and saved history will be available after the coordinated permissions and feature rollout.
      </p>
      <TestCalculationHistory />
    </div>
  );
}
