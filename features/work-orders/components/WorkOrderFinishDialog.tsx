import ConfirmDialog from "../../../shared/components/ConfirmDialog";

interface WorkOrderFinishDialogProps {
  open: boolean;
  workOrderNumber: string;
  projectName: string;
  materialCount: number;
  isConfirming: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

function WorkOrderFinishDialog({
  open,
  workOrderNumber,
  projectName,
  materialCount,
  isConfirming,
  onCancel,
  onConfirm,
}: WorkOrderFinishDialogProps) {
  const materialLabel = materialCount === 1
    ? "1 saved material"
    : `${materialCount} saved materials`;

  return (
    <ConfirmDialog
      open={open}
      title="Finish Work Order?"
      description={`Work Order ${workOrderNumber} for Project ${projectName} has ${materialLabel}. Finishing this Work Order will deduct the saved material quantities from Inventory, generate and finalize the official PDF, and permanently lock the Work Order as read-only.`}
      confirmLabel="Finish Work Order"
      confirmVariant="danger"
      isSubmitting={isConfirming}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

export default WorkOrderFinishDialog;
