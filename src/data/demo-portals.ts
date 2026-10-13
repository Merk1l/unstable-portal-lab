import type { Portal } from '../types';

const baseDate = '2026-10-13T18:45:00.000Z';

const buildEvent = (
  portalId: string,
  action: Portal['eventLog'][number]['action'],
  description: string,
  result: Portal['eventLog'][number]['result'],
) => ({
  id: `${portalId}-${action}-${Math.random().toString(36).slice(2, 10)}`,
  portalId,
  action,
  result,
  description,
  timestamp: baseDate,
});

export const DEMO_PORTALS: Portal[] = [
  {
    id: 'portal-a1',
    name: 'A1-Redgate',
    destination: 'The Emberic Wilds',
    energyLevel: 86,
    stability: 41,
    timeToCollapseMinutes: 18,
    occupants: 3,
    currentStatus: 'open',
    notes: 'Collapse window is shrinking rapidly. Risk spike observed around the outer lattice.',
    lastUpdated: baseDate,
    eventLog: [
      buildEvent('portal-a1', 'send_observer', 'Observer team preceded through the boundary to assess the fracture line.', 'completed'),
      buildEvent('portal-a1', 'mark_under_review', 'Portal flagged for manual review after repeat oscillation in the outer ring.', 'pending_review'),
    ],
  },
  {
    id: 'portal-b3',
    name: 'B3-Glassway',
    destination: 'Moonsea Relay',
    energyLevel: 58,
    stability: 72,
    timeToCollapseMinutes: 52,
    occupants: 1,
    currentStatus: 'open',
    notes: 'Stable but vulnerable to sudden energy surges. Observation remains active.',
    lastUpdated: baseDate,
    eventLog: [
      buildEvent('portal-b3', 'stabilize', 'Containment lattice tightened without interrupting transit traffic.', 'completed'),
    ],
  },
  {
    id: 'portal-c7',
    name: 'C7-Hollow',
    destination: 'Dust Vault',
    energyLevel: 36,
    stability: 89,
    timeToCollapseMinutes: 120,
    occupants: 0,
    currentStatus: 'under_review',
    notes: 'Portal is stable but flagged for review due to unusual depth oscillations.',
    lastUpdated: baseDate,
    eventLog: [
      buildEvent('portal-c7', 'mark_under_review', 'Anomalous drift in the energy envelope required additional verification.', 'pending_review'),
    ],
  },
  {
    id: 'portal-d2',
    name: 'D2-Salt Vein',
    destination: 'North Tundra',
    energyLevel: 18,
    stability: 94,
    timeToCollapseMinutes: 210,
    occupants: 0,
    currentStatus: 'closed',
    notes: 'Portal sealed after routine maintenance. No active hazard at the moment.',
    lastUpdated: baseDate,
    eventLog: [
      buildEvent('portal-d2', 'close', 'Closure completed after maintenance cycle and zero occupant check.', 'completed'),
    ],
  },
];
