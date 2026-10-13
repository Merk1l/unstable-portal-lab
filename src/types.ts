export type RiskLevel = 'low' | 'moderate' | 'high' | 'critical';
export type AccessDecision = 'allowed' | 'requires_check' | 'forbidden';
export type PortalStatus = 'open' | 'closed' | 'under_review';
export type PortalAction = 'stabilize' | 'close' | 'send_observer' | 'mark_under_review';

export interface PortalEvent {
  id: string;
  timestamp: string;
  portalId: string;
  action: PortalAction;
  result: 'completed' | 'blocked' | 'warning' | 'pending_review';
  description: string;
}

export interface Portal {
  id: string;
  name: string;
  destination: string;
  energyLevel: number;
  stability: number;
  timeToCollapseMinutes: number;
  occupants: number;
  currentStatus: PortalStatus;
  notes: string;
  lastUpdated: string;
  eventLog: PortalEvent[];
}
