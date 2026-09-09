import type {
  SupplierCreateResult,
  SupplierMutationInput,
} from "../services/supplierService";
import SupplierFormDialog from "./SupplierFormDialog";

export interface CreateSupplierDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: SupplierMutationInput) => Promise<SupplierCreateResult>;
  onCreated: () => void;
}

function CreateSupplierDialog({
  open,
  onClose,
  onSubmit,
  onCreated,
}: CreateSupplierDialogProps) {
  return (
    <SupplierFormDialog
      open={open}
      mode="create"
      onClose={onClose}
      onSubmit={onSubmit}
      onSucceeded={onCreated}
    />
  );
}

export default CreateSupplierDialog;
