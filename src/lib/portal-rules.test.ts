import { describe, expect, it } from 'vitest';

import {
  ACCESS_THRESHOLDS,
  applyPortalAction,
  calculateRisk,
  getAccessDecision,
  getRiskLevel,
  summarizePortals,
} from './portal-rules';
import type { Portal } from '../types';

const basePortal: Portal = {
  id: 'portal-01',
  name: 'Test Gate',
  destination: 'Altoria',
  energyLevel: 68,
  stability: 54,
  timeToCollapseMinutes: 38,
  occupants: 2,
  currentStatus: 'open',
  notes: 'Ready for validation.',
  lastUpdated: '2026-10-13T12:00:00.000Z',
  eventLog: [],
};

describe('portal risk model', () => {
  it('calculates an explainable risk score and assigns a low-risk band for stable portals', () => {
    const stablePortal: Portal = {
      ...basePortal,
      energyLevel: 28,
      stability: 88,
      timeToCollapseMinutes: 120,
    };

    const risk = calculateRisk(stablePortal);

    expect(risk).toBeGreaterThan(0);
    expect(risk).toBeLessThan(ACCESS_THRESHOLDS.allowedMaxRisk + 10);
    expect(getRiskLevel(risk)).toBe('low');
  });

  it('marks high-energy, low-stability, short-window portals as critical risk', () => {
    const criticalPortal: Portal = {
      ...basePortal,
      energyLevel: 92,
      stability: 18,
      timeToCollapseMinutes: 9,
      occupants: 7,
    };

    const risk = calculateRisk(criticalPortal);

    expect(risk).toBeGreaterThan(75);
    expect(getRiskLevel(risk)).toBe('critical');
  });

  it('resolves access decisions based on risk, stability and collapse window', () => {
    expect(getAccessDecision(basePortal)).toBe('requires_check');

    const allowedPortal: Portal = {
      ...basePortal,
      energyLevel: 30,
      stability: 78,
      timeToCollapseMinutes: 90,
    };

    expect(getAccessDecision(allowedPortal)).toBe('allowed');
  });

  it('blocks a portal from stabilizing after closure', () => {
    const closedPortal: Portal = { ...basePortal, currentStatus: 'closed' };

    expect(() => applyPortalAction(closedPortal, 'stabilize')).toThrow(
      'A closed portal cannot be stabilized.',
    );
  });

  it('requires explicit confirmation before closing a portal with occupants remaining inside', () => {
    expect(() => applyPortalAction(basePortal, 'close')).toThrow(
      'Portal cannot be closed while creatures or personnel remain inside without explicit confirmation.',
    );

    const closed = applyPortalAction(basePortal, 'close', { confirmClose: true });
    expect(closed.currentStatus).toBe('closed');
    expect(closed.timeToCollapseMinutes).toBe(0);
  });

  it('records new journal events and keeps summary counts aligned with the portal list', () => {
    const stabilized = applyPortalAction(basePortal, 'stabilize');
    expect(stabilized.eventLog[0].action).toBe('stabilize');
    expect(stabilized.stability).toBeGreaterThan(basePortal.stability);

    const summary = summarizePortals([stabilized]);
    expect(summary.openPortals).toBe(1);
    expect(summary.closedPortals).toBe(0);
  });
});
