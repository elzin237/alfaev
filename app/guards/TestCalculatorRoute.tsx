import { useAuth } from "../auth/AuthProvider";
import ErrorState from "../../shared/components/ErrorState";
import LoadingState from "../../shared/components/LoadingState";
import ProductCalculatorNavigation from "../../features/pcb/components/ProductCalculatorNavigation";
import { Outlet } from "react-router";
import { isTestCalculatorEnabled } from "../config/testCalculatorActivation";
import { useTestCalculatorAccess } from "../../features/test-calculator/hooks/useTestCalculatorAccess";

function ActivatedRoute() {
  const access = useTestCalculatorAccess(true);
  if (access.isLoading) return <LoadingState message="Checking your access..." />;
  if (!access.canView) return <ErrorState title="Access denied" message="Test Calculator view permission is required." />;
  return <Outlet />;
}
/** Closed release gate has no Admin or pcb.edit bypass and performs no Test reads. */
export default function TestCalculatorRoute() {
  const { session, profile, isActive, isLoading, error } = useAuth();
  if (isLoading) return <LoadingState message="Checking your access..." />;
  if (error || !session || !profile?.isActive || !isActive || profile.authUserId !== session.user.id) {
    return <ErrorState title="Access denied" message="Your active Test Calculator access could not be verified." />;
  }
  if (isTestCalculatorEnabled()) return <ActivatedRoute />;
  return (
    <div className="space-y-6">
      <ProductCalculatorNavigation />
      <ErrorState title="Test Calculator is not activated"
        message="Test Calculator requires the coordinated permission rollout: test_calculator.view for access and test_calculator.manage for creation. Normal Calculator remains available to authorized users." />
    </div>
  );
}
