import { Link } from "react-router";
import StatusBadge from "../../../shared/components/StatusBadge";
import type { TestConversion } from "../services/testCalculationConversionService";
import { formatHistoryTimestamp } from "../testCalculationHistoryDates";
export default function TestConversionProvenance({ conversion, detailed = false }: { conversion: TestConversion; detailed?: boolean }) {
  if (!conversion.imported) return null;
  return <div className="space-y-2 text-sm">
    <StatusBadge label="Imported" tone="success" />
    {detailed && <p className="text-zinc-600">Imported is provenance, separate from the Active/Expired deadline. Original allocations below are historical, not current commitments.</p>}
    {conversion.can_navigate && conversion.destination ? <div className="space-y-1 break-all">
      {detailed && <><p>Output serial: <span className="font-mono">{conversion.destination.serial_number}</span></p>
        <p>Destination Product: <span className="font-mono">{conversion.destination.product_id}</span></p>
        <p>Imported: <time dateTime={conversion.destination.imported_at}>{formatHistoryTimestamp(conversion.destination.imported_at)} Europe/Sarajevo</time></p></>}
      <Link className="inline-block font-semibold text-blue-800 underline" to={`/pcb/${conversion.destination.calculator_id}`}>View Calculator</Link>
    </div> : detailed && <p className="text-zinc-600">Destination details require current Product Calculator access.</p>}
  </div>;
}
