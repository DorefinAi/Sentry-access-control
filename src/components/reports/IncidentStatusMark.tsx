import { HealthLabel } from "@/components/common/Health";
import { INCIDENT_STATUS_LABELS } from "@/lib/labels";
import type { IncidentStatus } from "@/types/control";

const STATUS_HEALTH = { open: "down", monitoring: "warn", resolved: "ok" } as const;

export function IncidentStatusMark({ status }: { status: IncidentStatus }) {
  return <HealthLabel health={STATUS_HEALTH[status]} label={INCIDENT_STATUS_LABELS[status]} size="caption" />;
}
