import type {
  AccessDecision,
  Portal,
  PortalAction,
  PortalDraft,
  PortalEvent,
  PortalOperationKind,
  RiskLevel,
} from '../types';

export const RISK_WEIGHTS = {
  energy: 0.3,
  instability: 0.25,
  timeUrgency: 0.2,
  occupantExposure: 0.25,
} as const;

export const RISK_THRESHOLDS = {
  moderate: 25,
  high: 50,
  critical: 75,
} as const;

export const OBSERVER_MIN_COLLAPSE_WINDOW_MINUTES = 15;

export const ACCESS_THRESHOLDS = {
  allowedMaxRisk: 35,
  forbiddenMinRisk: RISK_THRESHOLDS.high,
  allowedMinStability: 55,
  requiresCheckMinStability: 40,
  forbiddenMinStability: 35,
  allowedMinCollapseWindowMinutes: 45,
  requiresCheckMinCollapseWindowMinutes: 20,
  forbiddenMinCollapseWindowMinutes: OBSERVER_MIN_COLLAPSE_WINDOW_MINUTES,
} as const;

export const RISK_CALIBRATION_MINUTES = 180;
const MINUTE_MS = 60_000;
const SECOND_MS = 1_000;
export const DEFAULT_ENERGY_DRAIN_PER_MINUTE = 100 / RISK_CALIBRATION_MINUTES;
export const ENERGY_COST_PER_STABILIZATION = 12;
export const STABILITY_GAIN_PER_STABILIZATION = 20;
export const STABILITY_LOSS_PER_ENTRY = 1;
export const DEMO_PORTAL_REOPEN_DELAY_MS = 150 * MINUTE_MS;
export const OBSERVER_VISIT_DURATION_MS = 5 * MINUTE_MS;
export const OBSERVER_CLEARANCE_VALID_MS = 30 * MINUTE_MS;
export const OPERATION_DURATIONS_MS: Record<PortalOperationKind, number> = {
  stabilize: 2 * 60_000,
  close: 60_000,
  review: 2 * 60_000,
  observer: OBSERVER_VISIT_DURATION_MS,
};

export function normalizePortalName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function getEnergyDrainMultiplier(stability: number): number {
  return 2 - clamp(stability, 0, 100) / 100;
}

export function getBaseEnergyDrainPerMinute(portal: Portal): number {
  if (
    typeof portal.baseEnergyDrainPerMinute === 'number' &&
    Number.isFinite(portal.baseEnergyDrainPerMinute) &&
    portal.baseEnergyDrainPerMinute > 0
  ) {
    return portal.baseEnergyDrainPerMinute;
  }
  const calibrationMinutes = Math.max(portal.timeToCollapseMinutes, 0.1);
  return Math.max(
    portal.energyLevel /
      calibrationMinutes /
      getEnergyDrainMultiplier(portal.stability),
    0.01,
  );
}

export function getEnergyDrainRate(portal: Portal): number {
  return getBaseEnergyDrainPerMinute(portal) * getEnergyDrainMultiplier(portal.stability);
}

function parsedTime(value: string): number {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : Date.now();
}

export function getEnergyAt(portal: Portal, now = Date.now()): number {
  if (portal.currentStatus === 'closed') {
    return clamp(portal.energyLevel, 0, 100);
  }
  const energyUpdatedAt = portal.energyUpdatedAt
    ? parsedTime(portal.energyUpdatedAt)
    : parsedTime(portal.collapseEstimateUpdatedAt);
  const elapsedMinutes = Math.max(0, now - energyUpdatedAt) / MINUTE_MS;
  return clamp(portal.energyLevel - elapsedMinutes * getEnergyDrainRate(portal), 0, 100);
}

export function getStabilizationPreview(
  portal: Portal,
  now = Date.now(),
  durationMs = OPERATION_DURATIONS_MS.stabilize,
) {
  const completesAt = now + durationMs;
  const energyAfterOperation =
    getEnergyAt(portal, completesAt) - ENERGY_COST_PER_STABILIZATION;
  const stabilityAfterOperation = clamp(
    portal.stability + STABILITY_GAIN_PER_STABILIZATION,
    0,
    100,
  );
  const baseDrainPerMinute = getBaseEnergyDrainPerMinute(portal);
  const projectedMinutesAfter = Math.max(0, energyAfterOperation) /
    (baseDrainPerMinute * getEnergyDrainMultiplier(stabilityAfterOperation));
  return {
    energyNow: getEnergyAt(portal, now),
    energyAfter: clamp(energyAfterOperation, 0, 100),
    stabilityAfter: stabilityAfterOperation,
    minutesAfter: projectedMinutesAfter,
    possible:
      portal.stability > 0 &&
      getEnergyAt(portal, now) > 0 &&
      energyAfterOperation > 0,
  };
}

export function getCollapseAt(portal: Portal): number | null {
  if (portal.currentStatus === 'closed' || portal.currentStatus === 'collapsing') {
    return null;
  }
  const energyUpdatedAt = portal.energyUpdatedAt
    ? parsedTime(portal.energyUpdatedAt)
    : parsedTime(portal.collapseEstimateUpdatedAt);
  if (portal.stability <= 0 || portal.energyLevel <= 0) {
    return energyUpdatedAt;
  }
  const drainRate = getEnergyDrainRate(portal);
  return energyUpdatedAt + (portal.energyLevel / drainRate) * MINUTE_MS;
}

export function getRemainingCollapseSeconds(portal: Portal, now = Date.now()): number | null {
  if (portal.currentStatus === 'closed') {
    return null;
  }
  if (portal.currentStatus === 'collapsing') {
    return 0;
  }
  const collapseAt = getCollapseAt(portal);
  return collapseAt === null ? null : Math.max(0, Math.ceil((collapseAt - now) / SECOND_MS));
}

export function calculateRisk(portal: Portal, now = Date.now()): number {
  if (portal.currentStatus === 'closed') {
    return 0;
  }
  const remainingSeconds = getRemainingCollapseSeconds(portal, now);
  const remainingMinutes =
    remainingSeconds === null ? portal.timeToCollapseMinutes : remainingSeconds / 60;
  const energyRisk = (100 - getEnergyAt(portal, now)) * RISK_WEIGHTS.energy;
  const instabilityRisk = (100 - portal.stability) * RISK_WEIGHTS.instability;
  const timeRatio = clamp(remainingMinutes / RISK_CALIBRATION_MINUTES, 0, 1);
  const timeUrgencyRisk = (1 - timeRatio) * 100 * RISK_WEIGHTS.timeUrgency;
  const occupantExposure = clamp(
    (portal.occupants * 10) / Math.max(remainingMinutes, 0.1),
    0,
    100,
  );
  const occupantRisk = occupantExposure * RISK_WEIGHTS.occupantExposure;
  const weightedRisk = energyRisk + instabilityRisk + timeUrgencyRisk + occupantRisk;
  const evacuationCritical =
    portal.occupants > 0 &&
    remainingMinutes <= 2 &&
    occupantExposure >= 75;

  return clamp(Math.round(evacuationCritical ? Math.max(weightedRisk, RISK_THRESHOLDS.critical) : weightedRisk), 0, 100);
}

export function getRiskLevel(score: number): RiskLevel {
  if (score >= RISK_THRESHOLDS.critical) {
    return 'critical';
  }
  if (score >= RISK_THRESHOLDS.high) {
    return 'high';
  }
  if (score >= RISK_THRESHOLDS.moderate) {
    return 'moderate';
  }
  return 'low';
}

export function getAccessDecision(portal: Portal, now = Date.now()): AccessDecision {
  if (portal.currentStatus === 'closed' || portal.currentStatus === 'collapsing') {
    return 'forbidden';
  }

  const riskScore = calculateRisk(portal, now);
  const remainingSeconds = getRemainingCollapseSeconds(portal, now) ?? 0;
  const remainingMinutes = remainingSeconds / 60;
  const observerVerifiedAt = portal.observerVerifiedAt
    ? Date.parse(portal.observerVerifiedAt)
    : Number.NaN;
  const hasRecentObserverClearance =
    Number.isFinite(observerVerifiedAt) &&
    now - observerVerifiedAt >= 0 &&
    now - observerVerifiedAt <= OBSERVER_CLEARANCE_VALID_MS;

  if (
    riskScore >= ACCESS_THRESHOLDS.forbiddenMinRisk ||
    portal.stability < ACCESS_THRESHOLDS.forbiddenMinStability ||
    remainingMinutes < ACCESS_THRESHOLDS.forbiddenMinCollapseWindowMinutes
  ) {
    return 'forbidden';
  }
  if (
    hasRecentObserverClearance &&
    riskScore < RISK_THRESHOLDS.high &&
    portal.stability >= ACCESS_THRESHOLDS.forbiddenMinStability &&
    remainingMinutes >= OBSERVER_MIN_COLLAPSE_WINDOW_MINUTES
  ) {
    return 'allowed';
  }
  if (
    portal.stability < ACCESS_THRESHOLDS.requiresCheckMinStability ||
    remainingMinutes < ACCESS_THRESHOLDS.requiresCheckMinCollapseWindowMinutes ||
    riskScore > ACCESS_THRESHOLDS.allowedMaxRisk ||
    portal.stability < ACCESS_THRESHOLDS.allowedMinStability ||
    remainingMinutes < ACCESS_THRESHOLDS.allowedMinCollapseWindowMinutes
  ) {
    return 'requires_check';
  }
  return 'allowed';
}

export function evaluatePortal(portal: Portal, now = Date.now()) {
  const remainingSeconds = getRemainingCollapseSeconds(portal, now);
  const riskScore = calculateRisk(portal, now);
  return {
    riskScore,
    riskLevel: getRiskLevel(riskScore),
    accessDecision: getAccessDecision(portal, now),
    remainingSeconds,
  };
}

export function getRecommendedAction(portal: Portal, now = Date.now()): string {
  if (portal.currentStatus === 'closed') {
    return 'Портал закрыт; проход запрещён.';
  }
  const exitInstruction =
    portal.occupants > 0
      ? 'Организовать немедленный выход; фиксировать только фактически вернувшихся. '
      : '';
  if (portal.currentStatus === 'collapsing') {
    return `Запас энергии исчерпан или стабильность достигла 0%. ${exitInstruction}Портал закрывается немедленно, дополнительного окна нет.`;
  }
  const evaluation = evaluatePortal(portal, now);
  if (portal.pendingOperation?.kind === 'stabilize') {
    return `${exitInstruction}Стабилизация выполняется: после завершения запас уменьшится на 12 пунктов, стабильность вырастет на 20; скорость расхода пересчитается.`;
  }
  if (portal.pendingOperation?.kind === 'review') {
    return `${exitInstruction}Старая операция проверки ещё выполняется. Дождитесь её окончания или отмените.`;
  }
  if (portal.pendingOperation?.kind === 'close') {
    return `${exitInstruction}Закрытие выполняется. Можно отменить его до завершения.`;
  }
  if (portal.pendingOperation?.kind === 'observer') {
    return `Наблюдатель находится в портале; до возвращения осталось ${Math.ceil((Date.parse(portal.pendingOperation.completesAt) - now) / 60_000)} мин. Внутри учитывается и наблюдатель.`;
  }
  if (evaluation.riskLevel === 'critical') {
    const stabilizationAdvice =
      portal.stability <= 0
        ? 'Стабильность достигла 0%: портал схлопывается немедленно, стабилизация невозможна.'
        : getStabilizationPreview(portal, now).possible
          ? 'Стабилизация займёт 2 минуты; проверьте прогноз запаса до запуска.'
          : 'Запаса не хватит на двухминутную стабилизацию с оплатой; вход запрещён.';
    return `Критический риск: вход, включая отправку наблюдателя, запрещён. ${exitInstruction}${stabilizationAdvice} До схлопывания ${Math.ceil((evaluation.remainingSeconds ?? 0) / 60)} мин.; внутри ${portal.occupants}.`;
  }
  if (evaluation.riskLevel === 'high') {
    return 'Высокий риск: обычный проход запрещён. Наблюдателя можно отправить на 5 минут только при стабильности не ниже 35%, запасе времени от 15 минут и если его учёт не поднимет риск до критического.';
  }
  if (evaluation.accessDecision === 'forbidden') {
    return `Проход запрещён. ${exitInstruction}Начать стабилизацию и проверить безопасность находящихся внутри (${portal.occupants}).`;
  }
  if (portal.currentStatus === 'under_review') {
    return 'Портал ожидает решения смотрителя. Для обследования изнутри отправьте наблюдателя, если это допускают риск и таймер.';
  }
  if (evaluation.accessDecision === 'requires_check') {
    return 'Допуск требует проверки. Отправьте наблюдателя на 5 минут; его вход учитывается в числе находящихся внутри. После возвращения допуск пересчитается.';
  }
  if (portal.underQuestion) {
    return 'Портал помечен «под вопросом». Изучите журнал и показатели; при необходимости отправьте наблюдателя.';
  }
  return 'Продолжать наблюдение. Пересматривать решение при изменении показателей.';
}

export function summarizePortals(portals: Portal[], now = Date.now()) {
  const activePortals = portals.filter((portal) => portal.currentStatus !== 'closed');
  const criticalRisk = activePortals.filter(
    (portal) => evaluatePortal(portal, now).riskLevel === 'critical',
  ).length;
  const attentionPortals = portals
    .filter((portal) => {
      if ((portal.lostOccupants ?? 0) > 0 && !portal.incidentReviewedAt) {
        return true;
      }
      if (portal.currentStatus === 'closed') {
        return false;
      }
      const evaluation = evaluatePortal(portal, now);
      return (
        portal.underQuestion ||
        portal.currentStatus === 'under_review' ||
        portal.currentStatus === 'collapsing' ||
        evaluation.accessDecision !== 'allowed'
      );
    })
    .sort((left, right) => {
      const leftIncident = Number(
        (left.lostOccupants ?? 0) > 0 && !left.incidentReviewedAt,
      );
      const rightIncident = Number(
        (right.lostOccupants ?? 0) > 0 && !right.incidentReviewedAt,
      );
      const incidentOrder = rightIncident - leftIncident;
      if (incidentOrder !== 0) {
        return incidentOrder;
      }
      const leftClosed = left.currentStatus === 'closed';
      const rightClosed = right.currentStatus === 'closed';
      if (leftClosed || rightClosed) {
        return Number(leftClosed) - Number(rightClosed);
      }
      const leftEvaluation = evaluatePortal(left, now);
      const rightEvaluation = evaluatePortal(right, now);
      const priority = (portal: Portal, riskLevel: RiskLevel) => {
        if (portal.currentStatus === 'collapsing' || riskLevel === 'critical') return 0;
        if (riskLevel === 'high') return 1;
        if (portal.underQuestion) return 2;
        if (riskLevel === 'moderate') return 3;
        return 4;
      };
      return (
        priority(left, leftEvaluation.riskLevel) -
          priority(right, rightEvaluation.riskLevel) ||
        rightEvaluation.riskScore - leftEvaluation.riskScore ||
        right.occupants - left.occupants ||
        (leftEvaluation.remainingSeconds ?? Number.POSITIVE_INFINITY) -
          (rightEvaluation.remainingSeconds ?? Number.POSITIVE_INFINITY)
      );
    });
  return {
    openPortals: activePortals.length,
    criticalRisk,
    closedPortals: portals.length - activePortals.length,
    attentionPortals,
  };
}

function createEvent(
  portal: Pick<Portal, 'id' | 'eventLog'>,
  action: PortalAction,
  result: PortalEvent['result'],
  description: string,
  timestamp: string,
): PortalEvent {
  return {
    id: `${portal.id}:${timestamp}:${portal.eventLog.length}`,
    timestamp,
    portalId: portal.id,
    action,
    result,
    description,
  };
}

function withEvent(
  portal: Portal,
  action: PortalAction,
  result: PortalEvent['result'],
  description: string,
  timestamp = new Date().toISOString(),
): Portal {
  return {
    ...portal,
    lastUpdated: timestamp,
    eventLog: [createEvent(portal, action, result, description, timestamp), ...portal.eventLog],
  };
}

function collapseImmediately(
  portal: Portal,
  timestamp: number,
  cause: 'energy' | 'stability' | 'legacy',
): Portal {
  if (portal.currentStatus === 'closed') {
    return portal;
  }
  const happenedAt = new Date(timestamp).toISOString();
  const lostInIncident = portal.occupants;
  const reason =
    cause === 'stability'
      ? 'Стабильность достигла 0%.'
      : cause === 'energy'
        ? 'Запас энергии исчерпан.'
        : 'Схлопывание выполняется без дополнительной задержки.';
  const closed: Portal = {
    ...portal,
    energyLevel: cause === 'energy' ? 0 : getEnergyAt(portal, timestamp),
    energyUpdatedAt: happenedAt,
    timeToCollapseMinutes: 0,
    collapseEstimateUpdatedAt: happenedAt,
    collapseDeadlineAt: null,
    currentStatus: 'closed',
    pendingOperation: null,
    closedAt: happenedAt,
    closureReason:
      cause === 'energy'
        ? 'energy_depleted'
        : cause === 'stability'
          ? 'stability_depleted'
          : 'legacy_collapse',
    lostOccupants: lostInIncident > 0
      ? Math.max(portal.lostOccupants ?? 0, lostInIncident)
      : portal.lostOccupants ?? 0,
    notes:
      lostInIncident > 0
        ? `${reason} Портал схлопнулся немедленно; потеряны ${lostInIncident} человек/существ. Требуется внимание смотрителя.`
        : `${reason} Портал схлопнулся и закрылся немедленно.`,
  };
  if (lostInIncident > 0) {
    return withEvent(
      closed,
      'collapse_incident',
      'critical',
      `КРИТИЧЕСКОЕ ПРОИСШЕСТВИЕ: портал «${portal.name}» схлопнулся ${new Date(happenedAt).toLocaleString('ru-RU')}; причина: ${reason.toLowerCase()}; потеряны ${lostInIncident} человек/существ. Требуется внимание.`,
      happenedAt,
    );
  }
  return withEvent(closed, 'natural_collapse', 'completed', closed.notes, happenedAt);
}

export function createPortal(draft: PortalDraft, existingPortals: Portal[] = []): Portal {
  const name = draft.name.trim();
  const destination = draft.destination.trim();
  if (!name || !destination) {
    throw new Error('Укажите название портала и мир назначения.');
  }
  const normalizedName = normalizePortalName(name);
  if (
    existingPortals.some(
      (portal) => normalizePortalName(portal.name) === normalizedName,
    )
  ) {
    throw new Error('Портал с таким названием уже существует. Укажите уникальное название.');
  }
  if (
    !Number.isFinite(draft.energyLevel) ||
    draft.energyLevel < 0 ||
    draft.energyLevel > 100 ||
    !Number.isFinite(draft.stability) ||
    draft.stability < 0 ||
    draft.stability > 100 ||
    !Number.isSafeInteger(draft.occupants) ||
    draft.occupants < 0
  ) {
    throw new Error('Проверьте значения: проценты — от 0 до 100, число находящихся внутри — неотрицательное целое.');
  }

  const now = new Date().toISOString();
  const stabilityMultiplier = getEnergyDrainMultiplier(draft.stability);
  const projectedCollapseMinutes =
    draft.energyLevel /
    (DEFAULT_ENERGY_DRAIN_PER_MINUTE * stabilityMultiplier);
  const portal: Portal = {
    id: `portal-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    destination,
    energyLevel: draft.energyLevel,
    energyUpdatedAt: now,
    baseEnergyDrainPerMinute: DEFAULT_ENERGY_DRAIN_PER_MINUTE,
    stability: draft.stability,
    timeToCollapseMinutes: projectedCollapseMinutes,
    collapseEstimateUpdatedAt: now,
    collapseDeadlineAt: null,
    occupants: draft.occupants,
    currentStatus: 'open',
    notes: 'Новая запись. Требуется первичная оценка смотрителем.',
    lastUpdated: now,
    pendingOperation: null,
    underQuestion: false,
    observerVerifiedAt: null,
    eventLog: [],
  };
  const created = withEvent(
    portal,
    'create_portal',
    'completed',
    'Создана запись портала для наблюдения.',
    now,
  );
  if (portal.stability <= 0) {
    return collapseImmediately(created, Date.parse(now), 'stability');
  }
  if (portal.energyLevel <= 0) {
    return collapseImmediately(created, Date.parse(now), 'energy');
  }
  return created;
}

export function resetDemoPortals(templates: Portal[], now = Date.now()): Portal[] {
  const timestamp = new Date(now).toISOString();
  return templates.map((portal) => {
    const baseEnergyDrainPerMinute = getBaseEnergyDrainPerMinute(portal);
    return {
      ...portal,
      energyUpdatedAt: timestamp,
      baseEnergyDrainPerMinute,
      collapseEstimateUpdatedAt: timestamp,
      collapseDeadlineAt: null,
      lastUpdated: timestamp,
      closedAt: portal.currentStatus === 'closed' ? timestamp : null,
      pendingOperation: null,
      incidentReviewedAt: null,
      observerVerifiedAt: null,
      eventLog: portal.eventLog.map((event, index) => ({
        ...event,
        id: `${portal.id}:reset:${now}:${index}`,
        timestamp,
      })),
    };
  });
}

export function advanceDemoPortalCycles(
  portals: Portal[],
  templates: Portal[],
  now = Date.now(),
): Portal[] {
  const nextPortals = [...portals];
  const timestamp = new Date(now).toISOString();
  let changed = false;

  for (const template of templates) {
    const cyclePrefix = `${template.id}-cycle-`;
    const instances = nextPortals.filter(
      (portal) =>
        portal.id === template.id ||
        (portal.id.startsWith(cyclePrefix) &&
          /^\d+$/.test(portal.id.slice(cyclePrefix.length))),
    );
    if (instances.length === 0 || instances.some((portal) => portal.currentStatus !== 'closed')) {
      continue;
    }

    const lastClosedAt = Math.max(
      ...instances.map((portal) => Date.parse(portal.closedAt ?? portal.lastUpdated)),
    );
    if (
      !Number.isFinite(lastClosedAt) ||
      now < lastClosedAt + DEMO_PORTAL_REOPEN_DELAY_MS ||
      instances.some(
        (portal) =>
          (portal.lostOccupants ?? 0) > 0 && !portal.incidentReviewedAt,
      ) ||
      template.energyLevel <= 0 ||
      template.stability <= 0
    ) {
      continue;
    }
    if (
      nextPortals.some(
        (portal) =>
          !instances.includes(portal) &&
          normalizePortalName(portal.name) === normalizePortalName(template.name),
      )
    ) {
      continue;
    }

    const cycleNumber = instances.reduce((latest, portal) => {
      if (portal.id === template.id) {
        return Math.max(latest, 0);
      }
      return Math.max(latest, Number(portal.id.slice(cyclePrefix.length)) || 0);
    }, 0) + 1;
    const id = `${cyclePrefix}${cycleNumber}`;
    const baseEnergyDrainPerMinute = getBaseEnergyDrainPerMinute(template);
    const reopened: Portal = {
      ...template,
      id,
      energyUpdatedAt: timestamp,
      baseEnergyDrainPerMinute,
      collapseEstimateUpdatedAt: timestamp,
      collapseDeadlineAt: null,
      currentStatus: 'open',
      lastUpdated: timestamp,
      pendingOperation: null,
      lostOccupants: 0,
      incidentReviewedAt: null,
      closedAt: null,
      closureReason: null,
      observerVerifiedAt: null,
      notes: 'Автоматически открыта новая демонстрационная итерация. События предыдущих записей сохранены в журнале.',
      eventLog: [
        ...new Map(
          instances.flatMap((portal) => portal.eventLog).map((event) => [event.id, event]),
        ).values(),
        {
          id: `${id}:${timestamp}:cycle`,
          timestamp,
          portalId: id,
          action: 'create_portal',
          result: 'completed',
          description: `Автоматически открыта демонстрационная итерация ${cycleNumber}; предыдущая запись удалена из архива, события сохранены в журнале.`,
        },
      ],
    };
    const instanceIds = new Set(instances.map((portal) => portal.id));
    const retainedPortals = nextPortals.filter((portal) => !instanceIds.has(portal.id));
    nextPortals.splice(0, nextPortals.length, ...retainedPortals, reopened);
    changed = true;
  }

  return changed ? nextPortals : portals;
}

export function recordBlockedAction(portal: Portal, action: PortalAction, reason: string): Portal {
  return withEvent(portal, action, 'blocked', reason);
}

function startOperation(
  portal: Portal,
  kind: PortalOperationKind,
  previousStatus: Portal['currentStatus'],
  timestamp: string,
): Portal {
  const pendingOperation = {
    kind,
    startedAt: timestamp,
    completesAt: new Date(Date.parse(timestamp) + OPERATION_DURATIONS_MS[kind]).toISOString(),
    previousStatus: previousStatus === 'under_review' ? 'under_review' : 'open',
  } as const;
  const updated: Portal = {
    ...portal,
    pendingOperation,
    currentStatus:
      kind === 'review'
        ? 'under_review'
        : portal.currentStatus === 'collapsing'
          ? 'collapsing'
          : portal.currentStatus,
    lastUpdated: timestamp,
    eventLog: [...portal.eventLog],
  };
  const descriptions: Record<PortalOperationKind, string> = {
    stabilize: 'Стабилизация начата; расчётная длительность — 2 минуты.',
    close: 'Закрытие начато; расчётная длительность — 1 минута.',
    review: 'Ручная проверка начата.',
    observer: 'Наблюдатель вошёл в портал; расчётная длительность пребывания — 5 минут.',
  };
  return {
    ...updated,
    eventLog: [
      createEvent(
        updated,
        kind === 'stabilize'
          ? 'stabilize'
          : kind === 'close'
            ? 'close'
            : kind === 'observer'
              ? 'send_observer'
              : 'mark_under_review',
        'in_progress',
        descriptions[kind],
        timestamp,
      ),
      ...portal.eventLog,
    ],
  };
}

export function applyPortalAction(
  portal: Portal,
  action: PortalAction,
  options: { confirmClose?: boolean; occupantCount?: number; now?: number } = {},
): Portal {
  if (action === 'stabilize') {
    if (portal.pendingOperation) {
      throw new Error('Сначала завершите или отмените текущую операцию.');
    }
    if (
      portal.currentStatus === 'closed' ||
      portal.currentStatus === 'collapsing' ||
      portal.stability <= 0 ||
      getEnergyAt(portal, options.now ?? Date.now()) <= 0
    ) {
      throw new Error('Портал закрыт или уже достиг порога немедленного схлопывания; стабилизация невозможна.');
    }
    const eventTime = options.now ?? Date.now();
    const preview = getStabilizationPreview(portal, eventTime);
    if (!preview.possible) {
      throw new Error('Недостаточно энергии для стабилизации и её двухминутного выполнения.');
    }
    const now = new Date(eventTime).toISOString();
    return startOperation(portal, 'stabilize', portal.currentStatus, now);
  }
  if (action === 'close') {
    if (portal.pendingOperation) {
      throw new Error('Сначала завершите или отмените текущую операцию.');
    }
    if (portal.currentStatus === 'closed' || portal.currentStatus === 'collapsing') {
      throw new Error('Портал уже закрыт или схлопывается; ручное закрытие недоступно.');
    }
    if (portal.occupants > 0 && !options.confirmClose) {
      throw new Error('Внутри остаются существа или люди. Для закрытия требуется явное подтверждение.');
    }
    const now = new Date(options.now ?? Date.now()).toISOString();
    return startOperation(portal, 'close', portal.currentStatus, now);
  }
  if (action === 'send_observer') {
    if (portal.pendingOperation) {
      throw new Error('Сначала завершите или отмените текущую операцию.');
    }
    if (portal.currentStatus !== 'open') {
      throw new Error('Наблюдателя можно отправить только в открытый портал.');
    }
    const eventTime = options.now ?? Date.now();
    const remainingMinutes = (getRemainingCollapseSeconds(portal, eventTime) ?? 0) / 60;
    const riskScore = calculateRisk(portal, eventTime);
    if (riskScore >= RISK_THRESHOLDS.critical) {
      throw new Error('Нельзя отправить наблюдателя в портал с критическим риском.');
    }
    if (portal.stability < ACCESS_THRESHOLDS.forbiddenMinStability) {
      throw new Error('Нельзя отправить наблюдателя: стабильность ниже аварийного порога.');
    }
    if (remainingMinutes < OBSERVER_MIN_COLLAPSE_WINDOW_MINUTES) {
      throw new Error('Нельзя отправить наблюдателя: до схлопывания должно оставаться не менее 15 минут.');
    }
    if (portal.occupants >= Number.MAX_SAFE_INTEGER) {
      throw new Error('Невозможно учесть дополнительного наблюдателя.');
    }
    const withObserver = {
      ...portal,
      occupants: portal.occupants + 1,
      energyLevel: getEnergyAt(portal, eventTime),
      energyUpdatedAt: new Date(eventTime).toISOString(),
      baseEnergyDrainPerMinute: getBaseEnergyDrainPerMinute(portal),
      stability: clamp(portal.stability - STABILITY_LOSS_PER_ENTRY, 0, 100),
      timeToCollapseMinutes: 0,
      collapseEstimateUpdatedAt: new Date().toISOString(),
      observerVerifiedAt: null,
    };
    if (calculateRisk(withObserver, eventTime) >= RISK_THRESHOLDS.critical) {
      throw new Error('Нельзя отправить наблюдателя: его присутствие поднимет риск до критического уровня.');
    }
    return startOperation(withObserver, 'observer', 'open', new Date(eventTime).toISOString());
  }
  if (action === 'record_occupant_exit') {
    if (portal.currentStatus === 'closed' || portal.currentStatus === 'collapsing') {
      throw new Error('Нельзя зафиксировать выход: портал уже закрыт или схлопывается.');
    }
    const eventTime = options.now ?? Date.now();
    if (portal.stability <= 0 || getEnergyAt(portal, eventTime) <= 0) {
      throw new Error('Портал уже достиг порога схлопывания; проход через него невозможен.');
    }
    const count = options.occupantCount;
    if (!Number.isSafeInteger(count) || !count || count < 1) {
      throw new Error('Укажите положительное целое число вышедших.');
    }
    const countedObserver = portal.pendingOperation?.kind === 'observer' ? 1 : 0;
    const otherOccupants = portal.occupants - countedObserver;
    if (count > otherOccupants) {
      throw new Error(
        countedObserver
          ? `Нельзя зафиксировать выход ${count}: внутри ${otherOccupants} остальных, наблюдатель ещё не вернулся.`
          : `Нельзя зафиксировать выход ${count}: внутри только ${portal.occupants}.`,
      );
    }
    const remainingOccupants = portal.occupants - count;
    const energyAtPassage = getEnergyAt(portal, eventTime);
    const stabilityAfterPassage = clamp(
      portal.stability - count * STABILITY_LOSS_PER_ENTRY,
      0,
      100,
    );
    const updated = withEvent(
      {
        ...portal,
        occupants: remainingOccupants,
        energyLevel: energyAtPassage,
        energyUpdatedAt: new Date(eventTime).toISOString(),
        baseEnergyDrainPerMinute: getBaseEnergyDrainPerMinute(portal),
        stability: stabilityAfterPassage,
        timeToCollapseMinutes: 0,
        collapseEstimateUpdatedAt: new Date(eventTime).toISOString(),
        observerVerifiedAt: null,
        notes: `Зафиксирован выход ${count} человек/существ. Внутри осталось: ${remainingOccupants}.`,
      },
      action,
      'completed',
      `Смотритель подтвердил фактический выход ${count} человек/существ. Осталось внутри: ${remainingOccupants}.`,
      new Date(eventTime).toISOString(),
    );
    if (stabilityAfterPassage <= 0) {
      return collapseImmediately(updated, eventTime, 'stability');
    }
    if (energyAtPassage <= 0) {
      return collapseImmediately(updated, eventTime, 'energy');
    }
    return updated;
  }
  if (action === 'record_occupant_entry') {
    if (portal.currentStatus !== 'open' || portal.pendingOperation) {
      throw new Error('Вход можно зафиксировать только в открытый портал без выполняющейся операции.');
    }
    const count = options.occupantCount;
    if (!Number.isSafeInteger(count) || !count || count < 1) {
      throw new Error('Укажите положительное целое число вошедших.');
    }
    if (count > Number.MAX_SAFE_INTEGER - portal.occupants) {
      throw new Error('Количество находящихся внутри превышает безопасный диапазон.');
    }
    if (getAccessDecision(portal, options.now ?? Date.now()) !== 'allowed') {
      throw new Error('Вход запрещён: текущие условия портала не допускают проход.');
    }
    const updatedOccupants = portal.occupants + count;
    const eventTime = options.now ?? Date.now();
    const energyAtPassage = getEnergyAt(portal, eventTime);
    const stabilityAfterPassage = clamp(
      portal.stability - count * STABILITY_LOSS_PER_ENTRY,
      0,
      100,
    );
    const updatedPortal = {
      ...portal,
      occupants: updatedOccupants,
      energyLevel: energyAtPassage,
      energyUpdatedAt: new Date(eventTime).toISOString(),
      baseEnergyDrainPerMinute: getBaseEnergyDrainPerMinute(portal),
      stability: stabilityAfterPassage,
      timeToCollapseMinutes: 0,
      collapseEstimateUpdatedAt: new Date(eventTime).toISOString(),
    };
    if (getAccessDecision(updatedPortal, options.now ?? Date.now()) !== 'allowed') {
      throw new Error('Такое количество вошедших поднимет риск выше допустимого для прохода.');
    }
    return withEvent(
      {
        ...updatedPortal,
        notes: `Зафиксирован вход ${count} человек/существ. Внутри: ${updatedOccupants}.`,
      },
      action,
      'completed',
      `Смотритель подтвердил фактический вход ${count} человек/существ. Всего внутри: ${updatedOccupants}.`,
      new Date(eventTime).toISOString(),
    );
  }
  if (action === 'mark_under_review') {
    if (portal.pendingOperation) {
      throw new Error('Сначала завершите или отмените текущую операцию.');
    }
    if (portal.currentStatus === 'closed' || portal.currentStatus === 'collapsing') {
      throw new Error('Закрытый портал или портал, который схлопывается, нельзя пометить «под вопросом».');
    }
    const now = new Date(options.now ?? Date.now()).toISOString();
    const underQuestion = !portal.underQuestion;
    return withEvent(
      { ...portal, underQuestion },
      action,
      'completed',
      underQuestion ? 'Портал помечен «под вопросом».' : 'Отметка «под вопросом» снята.',
      now,
    );
  }
  throw new Error(`Неизвестное действие: ${action}`);
}

export function cancelPortalOperation(portal: Portal, now = Date.now()): Portal {
  if (portal.currentStatus === 'closed') {
    throw new Error('Закрытый портал не может иметь отменяемых операций.');
  }
  const operation = portal.pendingOperation;
  if (!operation) {
    throw new Error('Нет операции, которую можно отменить.');
  }
  const advanced = advancePortals([portal], now)[0];
  if (advanced !== portal) {
    return advanced;
  }
  const timestamp = new Date(now).toISOString();
  const restoredStatus =
    portal.currentStatus === 'under_review'
      ? operation.previousStatus === 'under_review'
        ? 'open'
        : operation.previousStatus
      : portal.currentStatus;
  const observerReturned = operation.kind === 'observer';
  const stabilityAfterReturn = observerReturned
    ? clamp(portal.stability - STABILITY_LOSS_PER_ENTRY, 0, 100)
    : portal.stability;
  return {
    ...portal,
    occupants: observerReturned ? Math.max(0, portal.occupants - 1) : portal.occupants,
    energyLevel: observerReturned ? getEnergyAt(portal, now) : portal.energyLevel,
    energyUpdatedAt: observerReturned
      ? timestamp
      : portal.energyUpdatedAt,
    baseEnergyDrainPerMinute: observerReturned
      ? getBaseEnergyDrainPerMinute(portal)
      : portal.baseEnergyDrainPerMinute,
    stability: stabilityAfterReturn,
    currentStatus: restoredStatus,
    pendingOperation: null,
    lastUpdated: timestamp,
    eventLog: [
      createEvent(
        portal,
        'cancel_operation',
        'completed',
        observerReturned
          ? 'Наблюдатель досрочно вернулся из портала; его больше не учитывают среди находящихся внутри.'
          : `Операция «${operation.kind}» отменена пользователем до завершения.`,
        timestamp,
      ),
      ...portal.eventLog,
    ],
  };
}

function completeOperation(portal: Portal, completedAt: number): Portal {
  const operation = portal.pendingOperation;
  if (!operation) {
    return portal;
  }
  const timestamp = new Date(completedAt).toISOString();
  const base: Portal = {
    ...portal,
    pendingOperation: null,
    lastUpdated: timestamp,
    eventLog: [...portal.eventLog],
  };

  if (operation.kind === 'stabilize') {
    const energyAtCompletion = getEnergyAt(portal, completedAt);
    if (portal.currentStatus === 'collapsing' || energyAtCompletion <= ENERGY_COST_PER_STABILIZATION) {
      const interrupted: Portal = {
        ...base,
        energyLevel: energyAtCompletion,
        energyUpdatedAt: timestamp,
        timeToCollapseMinutes: 0,
        collapseEstimateUpdatedAt: timestamp,
        currentStatus: portal.currentStatus,
        notes: 'Стабилизация прервана: к завершению не осталось достаточного энергетического запаса.',
      };
      return withEvent(
        interrupted,
        'stabilize',
        'warning',
        interrupted.notes,
        timestamp,
      );
    }
    const energyAfterCost = energyAtCompletion - ENERGY_COST_PER_STABILIZATION;
    const stabilityAfter = clamp(
      portal.stability + STABILITY_GAIN_PER_STABILIZATION,
      0,
      100,
    );
    const drainAfter = getBaseEnergyDrainPerMinute(portal) *
      getEnergyDrainMultiplier(stabilityAfter);
    const stabilized: Portal = {
      ...base,
      stability: stabilityAfter,
      energyLevel: energyAfterCost,
      energyUpdatedAt: timestamp,
      baseEnergyDrainPerMinute: getBaseEnergyDrainPerMinute(portal),
      timeToCollapseMinutes: energyAfterCost / drainAfter,
      collapseEstimateUpdatedAt: timestamp,
      collapseDeadlineAt: null,
      currentStatus:
        operation.previousStatus === 'under_review'
          ? 'open'
          : operation.previousStatus,
      notes: 'Стабилизация завершена: запас энергии уменьшен, стабильность повышена, расход энергии замедлен.',
    };
    return withEvent(stabilized, 'stabilize', 'completed', stabilized.notes, timestamp);
  }

  if (operation.kind === 'close') {
    const energyAtCompletion = getEnergyAt(portal, completedAt);
    const closureTimestamp = new Date(completedAt).toISOString();
    const closed: Portal = {
      ...base,
      currentStatus: 'closed',
      energyLevel: energyAtCompletion,
      energyUpdatedAt: timestamp,
      closedAt: closureTimestamp,
      closureReason: 'manual_close',
      pendingOperation: null,
      timeToCollapseMinutes: getRemainingCollapseSeconds(portal, completedAt) === null
        ? portal.timeToCollapseMinutes
        : (getRemainingCollapseSeconds(portal, completedAt) ?? 0) / 60,
      collapseEstimateUpdatedAt: timestamp,
      collapseDeadlineAt: null,
      notes: 'Портал закрыт после завершения операции.',
    };
    return withEvent(closed, 'close', 'completed', 'Портал закрыт по завершении операции.', timestamp);
  }

  if (operation.kind === 'observer') {
    const returned = portal.occupants > 0;
    const stabilityAfterReturn = returned
      ? clamp(portal.stability - STABILITY_LOSS_PER_ENTRY, 0, 100)
      : portal.stability;
    const energyAtReturn = getEnergyAt(portal, completedAt);
    const completed: Portal = {
      ...base,
      occupants: returned ? portal.occupants - 1 : portal.occupants,
      energyLevel: energyAtReturn,
      energyUpdatedAt: timestamp,
      baseEnergyDrainPerMinute: getBaseEnergyDrainPerMinute(portal),
      stability: stabilityAfterReturn,
      timeToCollapseMinutes: 0,
      collapseEstimateUpdatedAt: timestamp,
      observerVerifiedAt: portal.currentStatus === 'collapsing' ? null : timestamp,
      notes:
        portal.currentStatus === 'collapsing'
          ? 'Наблюдатель вернулся, но портал уже схлопывается; проход остаётся запрещён.'
          : 'Наблюдатель вернулся после осмотра; допуск и риск пересчитаны по текущим показателям.',
    };
    const completedWithEvent = withEvent(
      completed,
      'send_observer',
      portal.currentStatus === 'collapsing' ? 'warning' : 'completed',
      completed.notes,
      timestamp,
    );
    if (completed.stability <= 0) {
      return collapseImmediately(completedWithEvent, completedAt, 'stability');
    }
    if (getEnergyAt(completedWithEvent, completedAt) <= 0) {
      return collapseImmediately(completedWithEvent, completedAt, 'energy');
    }
    return completedWithEvent;
  }

  const completed: Portal = {
    ...base,
    currentStatus:
      portal.currentStatus === 'collapsing'
        ? 'collapsing'
        : operation.previousStatus === 'under_review'
          ? 'open'
          : operation.previousStatus,
    notes:
      portal.currentStatus === 'collapsing'
        ? 'Проверка завершена, но схлопывание продолжается.'
        : 'Проверка завершена; требуется новое решение смотрителя.',
  };
  return withEvent(
    completed,
    'mark_under_review',
    portal.currentStatus === 'collapsing' ? 'warning' : 'completed',
    completed.notes,
    timestamp,
  );
}

export function advancePortals(
  portals: Portal[],
  now = Date.now(),
): Portal[] {
  let changed = false;
  const nextPortals = portals.map((original) => {
    if (original.currentStatus === 'closed') {
      return original;
    }
    if (original.currentStatus === 'collapsing') {
      const portal = collapseImmediately(original, now, 'legacy');
      changed = true;
      return portal;
    }

    let portal = original;
    const initialCollapseAt = getCollapseAt(portal);
    const operation = portal.pendingOperation;
    if (
      operation &&
      Date.parse(operation.completesAt) <= now &&
      (initialCollapseAt === null || Date.parse(operation.completesAt) < initialCollapseAt)
    ) {
      portal = completeOperation(portal, Date.parse(operation.completesAt));
    }

    const collapseAt = getCollapseAt(portal);
    if (collapseAt !== null && collapseAt <= now) {
      const cause = portal.stability <= 0 ? 'stability' : 'energy';
      portal = collapseImmediately(portal, collapseAt, cause);
    }

    if (portal !== original) {
      changed = true;
    }
    return portal;
  });
  return changed ? nextPortals : portals;
}
