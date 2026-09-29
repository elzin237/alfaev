import ConfirmDialog from "../../../shared/components/ConfirmDialog";

interface WorkOrderDeleteDraftDialogProps {
  open: boolean;
  workOrderNumber: string;
  isDeleting: boolean;
  errorMessage: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

function WorkOrderDeleteDraftDialog({
  open,
  workOrderNumber,
  isDeleting,
  errorMessage,
  onCancel,
  onConfirm,
}: WorkOrderDeleteDraftDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      title="Delete Draft Work Order?"
      description={`Delete ${workOrderNumber} permanently? This Draft and its saved materials will be removed. The Work Order number will not be reused.`}
      confirmLabel="Delete Draft"
      confirmVariant="danger"
      isSubmitting={isDeleting}
      errorMessage={errorMessage}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

export default WorkOrderDeleteDraftDialog;
