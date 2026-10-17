export type RiskLevel = 'low' | 'moderate' | 'high' | 'critical';
export type AccessDecision = 'allowed' | 'requires_check' | 'forbidden';
export type PortalStatus = 'open' | 'under_review' | 'collapsing' | 'closed';
export type PortalClosureReason =
  | 'manual_close'
  | 'energy_depleted'
  | 'stability_depleted'
  | 'legacy_collapse'
  | 'unknown';
export type PortalAction =
  | 'stabilize'
  | 'close'
  | 'send_observer'
  | 'record_occupant_exit'
  | 'record_occupant_entry'
  | 'mark_under_review'
  | 'cancel_operation'
  | 'natural_collapse'
  | 'collapse_incident'
  | 'create_portal';
export type PortalOperationKind = 'stabilize' | 'close' | 'review' | 'observer';

export interface PortalOperation {
  kind: PortalOperationKind;
  startedAt: string;
  completesAt: string;
  previousStatus: 'open' | 'under_review';
}

export interface PortalEvent {
  id: string;
  timestamp: string;
  portalId: string;
  action: PortalAction;
  result: 'completed' | 'blocked' | 'warning' | 'critical' | 'pending_review' | 'in_progress';
  description: string;
}

export interface Portal {
  id: string;
  name: string;
  destination: string;
  energyLevel: number;
  energyUpdatedAt?: string;
  baseEnergyDrainPerMinute?: number;
  stability: number;
  timeToCollapseMinutes: number;
  collapseEstimateUpdatedAt: string;
  collapseDeadlineAt: string | null;
  occupants: number;
  lostOccupants?: number;
  incidentReviewedAt?: string | null;
  closedAt?: string | null;
  closureReason?: PortalClosureReason | null;
  currentStatus: PortalStatus;
  notes: string;
  lastUpdated: string;
  pendingOperation: PortalOperation | null;
  underQuestion: boolean;
  observerVerifiedAt: string | null;
  eventLog: PortalEvent[];
}

export interface PortalDraft {
  name: string;
  destination: string;
  energyLevel: number;
  stability: number;
  occupants: number;
}
