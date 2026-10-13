import type { AccessDecision, Portal, PortalAction, PortalEvent, RiskLevel } from '../types';

export const RISK_WEIGHTS = {
  energy: 0.45,
  stability: 0.35,
  urgency: 0.2,
} as const;

export const ACCESS_THRESHOLDS = {
  allowedMaxRisk: 35,
  requiresCheckMaxRisk: 60,
  allowedMinStability: 55,
  requiresCheckMinStability: 40,
  allowedMinCollapseWindow: 45,
  requiresCheckMinCollapseWindow: 20,
  forbiddenRisk: 70,
} as const;

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function calculateRisk(
  portal: Pick<Portal, 'energyLevel' | 'stability' | 'timeToCollapseMinutes'>,
): number {
  const energyRisk = (portal.energyLevel / 100) * 100 * RISK_WEIGHTS.energy;
  const stabilityRisk = ((100 - portal.stability) / 100) * 100 * RISK_WEIGHTS.stability;
  const urgencyWindow = 180;
  const collapseWindowRatio = clamp(portal.timeToCollapseMinutes / urgencyWindow, 0, 1);
  const urgencyRisk = (1 - collapseWindowRatio) * 100 * RISK_WEIGHTS.urgency;

  return clamp(Math.round(energyRisk + stabilityRisk + urgencyRisk), 0, 100);
}

export function getRiskLevel(score: number): RiskLevel {
  if (score >= 75) {
    return 'critical';
  }
  if (score >= 50) {
    return 'high';
  }
  if (score >= 25) {
    return 'moderate';
  }
  return 'low';
}

export function getAccessDecision(
  portal: Pick<Portal, 'energyLevel' | 'stability' | 'timeToCollapseMinutes'>,
): AccessDecision {
  const riskScore = calculateRisk(portal);
  const { stability, timeToCollapseMinutes } = portal;

  if (
    riskScore >= ACCESS_THRESHOLDS.forbiddenRisk ||
    stability < 35 ||
    timeToCollapseMinutes < 15
  ) {
    return 'forbidden';
  }

  if (
    riskScore >= ACCESS_THRESHOLDS.requiresCheckMaxRisk ||
    stability < ACCESS_THRESHOLDS.requiresCheckMinStability ||
    timeToCollapseMinutes < ACCESS_THRESHOLDS.requiresCheckMinCollapseWindow
  ) {
    return 'requires_check';
  }

  if (
    riskScore > ACCESS_THRESHOLDS.allowedMaxRisk ||
    stability < ACCESS_THRESHOLDS.allowedMinStability ||
    timeToCollapseMinutes < ACCESS_THRESHOLDS.allowedMinCollapseWindow
  ) {
    return 'requires_check';
  }

  return 'allowed';
}

export function evaluatePortal(portal: Portal) {
  const riskScore = calculateRisk(portal);

  return {
    riskScore,
    riskLevel: getRiskLevel(riskScore),
    accessDecision: getAccessDecision(portal),
  };
}

export function summarizePortals(portals: Portal[]) {
  const criticalRisk = portals.filter((portal) => getRiskLevel(calculateRisk(portal)) === 'critical').length;
  const openPortals = portals.filter((portal) => portal.currentStatus !== 'closed').length;
  const closedPortals = portals.filter((portal) => portal.currentStatus === 'closed').length;

  const attentionPortals = portals.filter((portal) => {
    const evaluation = evaluatePortal(portal);
    return (
      portal.currentStatus === 'under_review' ||
      evaluation.accessDecision !== 'allowed' ||
      evaluation.riskLevel === 'critical'
    );
  }).length;

  return {
    openPortals,
    criticalRisk,
    closedPortals,
    attentionPortals,
  };
}

function createPortalEvent(
  portal: Portal,
  action: PortalAction,
  result: PortalEvent['result'],
  description: string,
): PortalEvent {
  return {
    id: `${portal.id}:${action}:${Date.now()}`,
    portalId: portal.id,
    action,
    result,
    description,
    timestamp: new Date().toISOString(),
  };
}

export function applyPortalAction(
  portal: Portal,
  action: PortalAction,
  options: { confirmClose?: boolean; note?: string } = {},
): Portal {
  const now = new Date().toISOString();
  const nextPortal: Portal = {
    ...portal,
    lastUpdated: now,
    eventLog: [...portal.eventLog],
  };

  if (action === 'stabilize') {
    if (portal.currentStatus === 'closed') {
      throw new Error('A closed portal cannot be stabilized.');
    }

    nextPortal.stability = clamp(portal.stability + 20, 0, 100);
    nextPortal.energyLevel = clamp(portal.energyLevel - 12, 0, 100);
    nextPortal.timeToCollapseMinutes = Math.max(0, portal.timeToCollapseMinutes + 22);
    nextPortal.currentStatus = 'open';
    nextPortal.notes = options.note ?? 'Containment lattice recalibrated to buy additional time before collapse.';
    nextPortal.eventLog.unshift(
      createPortalEvent(
        nextPortal,
        'stabilize',
        'completed',
        'Containment lattice recalibrated, stability improved and collapse margin extended.',
      ),
    );

    return nextPortal;
  }

  if (action === 'close') {
    if (portal.currentStatus === 'closed') {
      throw new Error('Portal is already closed.');
    }

    if (portal.occupants > 0 && !options.confirmClose) {
      throw new Error('Portal cannot be closed while creatures or personnel remain inside without explicit confirmation.');
    }

    nextPortal.currentStatus = 'closed';
    nextPortal.timeToCollapseMinutes = 0;
    nextPortal.notes = options.note ?? 'Portal intentionally sealed due to operational decision.';
    nextPortal.eventLog.unshift(
      createPortalEvent(
        nextPortal,
        'close',
        'completed',
        portal.occupants > 0
          ? 'Closure confirmed despite occupants remaining inside. Emergency breach protocol activated.'
          : 'Portal sealed cleanly after safety review.',
      ),
    );

    return nextPortal;
  }

  if (action === 'send_observer') {
    if (portal.currentStatus === 'closed') {
      throw new Error('A closed portal cannot receive an observer team.');
    }

    const evaluation = evaluatePortal(portal);
    if (evaluation.riskLevel === 'critical' || evaluation.accessDecision === 'forbidden') {
      throw new Error('An observer cannot be sent into a portal with critical hazard conditions.');
    }

    nextPortal.currentStatus = 'open';
    nextPortal.notes = options.note ?? 'Observer team dispatched to inspect the portal perimeter.';
    nextPortal.eventLog.unshift(
      createPortalEvent(
        nextPortal,
        'send_observer',
        'completed',
        'Observer team dispatched with a focused inspection objective and active status tracking.',
      ),
    );

    return nextPortal;
  }

  if (action === 'mark_under_review') {
    if (portal.currentStatus === 'closed') {
      throw new Error('Closed portals are not moved to investigation status.');
    }

    nextPortal.currentStatus = 'under_review';
    nextPortal.notes = options.note ?? 'Portal flagged for additional verification; no automatic technical modification was applied.';
    nextPortal.eventLog.unshift(
      createPortalEvent(
        nextPortal,
        'mark_under_review',
        'pending_review',
        'Portal flagged for additional verification; technical values remain unchanged until an operator confirms the next step.',
      ),
    );

    return nextPortal;
  }

  throw new Error(`Unsupported action: ${action}`);
}
