import type {
  Portal,
  PortalAction,
  PortalClosureReason,
  PortalEvent,
  PortalOperation,
  PortalStatus,
} from '../types';

export const STORAGE_KEY = 'portal-control-system:v1';

export interface PortalLoadResult {
  status: 'loaded' | 'missing' | 'error';
  portals: Portal[];
  warning: string | null;
}

export interface PortalSaveResult {
  ok: boolean;
  error: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPortalAction(value: unknown): value is PortalAction {
  return (
    value === 'stabilize' ||
    value === 'close' ||
    value === 'send_observer' ||
    value === 'record_occupant_exit' ||
    value === 'record_occupant_entry' ||
    value === 'mark_under_review' ||
    value === 'cancel_operation' ||
    value === 'natural_collapse' ||
    value === 'collapse_incident' ||
    value === 'create_portal'
  );
}

function isPortalResult(value: unknown): value is PortalEvent['result'] {
  return (
    value === 'completed' ||
    value === 'blocked' ||
    value === 'warning' ||
    value === 'critical' ||
    value === 'pending_review' ||
    value === 'in_progress'
  );
}

function isPortalStatus(value: unknown): value is PortalStatus {
  return (
    value === 'open' ||
    value === 'closed' ||
    value === 'under_review' ||
    value === 'collapsing'
  );
}

function isPortalClosureReason(value: unknown): value is PortalClosureReason {
  return (
    value === 'manual_close' ||
    value === 'energy_depleted' ||
    value === 'stability_depleted' ||
    value === 'legacy_collapse' ||
    value === 'unknown'
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isSafeInteger(value) && value >= 0;
}

function isPortalEnvelope(
  value: unknown,
): value is Record<string, unknown> & { portals: unknown[] } {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    Array.isArray(value.portals) &&
    (value.isDemo === undefined || typeof value.isDemo === 'boolean')
  );
}

function parseOperation(value: unknown): PortalOperation | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (!isRecord(value)) {
    return null;
  }
  const { kind, startedAt, completesAt, previousStatus } = value;
  if (
    (kind !== 'stabilize' && kind !== 'close' && kind !== 'review' && kind !== 'observer') ||
    typeof startedAt !== 'string' ||
    !Number.isFinite(Date.parse(startedAt)) ||
    typeof completesAt !== 'string' ||
    !Number.isFinite(Date.parse(completesAt)) ||
    (previousStatus !== 'open' && previousStatus !== 'under_review')
  ) {
    return null;
  }
  return { kind, startedAt, completesAt, previousStatus };
}

function parseEvent(value: unknown): PortalEvent | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.timestamp !== 'string' ||
    !Number.isFinite(Date.parse(value.timestamp)) ||
    typeof value.portalId !== 'string' ||
    !isPortalAction(value.action) ||
    !isPortalResult(value.result) ||
    typeof value.description !== 'string'
  ) {
    return null;
  }
  return {
    id: value.id,
    timestamp: value.timestamp,
    portalId: value.portalId,
    action: value.action,
    result: value.result,
    description: value.description,
  };
}

function parsePortal(value: unknown): Portal | null {
  if (!isRecord(value)) {
    return null;
  }
  const {
    id,
    name,
    destination,
    energyLevel,
    energyUpdatedAt,
    baseEnergyDrainPerMinute,
    stability,
    timeToCollapseMinutes,
    occupants,
    currentStatus,
    notes,
    lastUpdated,
    collapseEstimateUpdatedAt,
    collapseDeadlineAt,
    pendingOperation,
    lostOccupants,
    incidentReviewedAt,
    closedAt,
    closureReason,
    underQuestion,
    observerVerifiedAt,
    eventLog,
  } = value;
  if (
    typeof id !== 'string' ||
    typeof name !== 'string' ||
    typeof destination !== 'string' ||
    !isFiniteNumber(energyLevel) ||
    energyLevel < 0 ||
    energyLevel > 100 ||
    (energyUpdatedAt !== undefined &&
      (typeof energyUpdatedAt !== 'string' ||
        !Number.isFinite(Date.parse(energyUpdatedAt)))) ||
    (baseEnergyDrainPerMinute !== undefined &&
      (!isFiniteNumber(baseEnergyDrainPerMinute) || baseEnergyDrainPerMinute <= 0)) ||
    !isFiniteNumber(stability) ||
    stability < 0 ||
    stability > 100 ||
    !isFiniteNumber(timeToCollapseMinutes) ||
    timeToCollapseMinutes < 0 ||
    !isNonNegativeInteger(occupants) ||
    (lostOccupants !== undefined && !isNonNegativeInteger(lostOccupants)) ||
    (incidentReviewedAt !== undefined &&
      incidentReviewedAt !== null &&
      (typeof incidentReviewedAt !== 'string' ||
        !Number.isFinite(Date.parse(incidentReviewedAt)))) ||
    (closedAt !== undefined &&
      closedAt !== null &&
      (typeof closedAt !== 'string' || !Number.isFinite(Date.parse(closedAt)))) ||
    (closureReason !== undefined &&
      closureReason !== null &&
      !isPortalClosureReason(closureReason)) ||
    !isPortalStatus(currentStatus) ||
    typeof notes !== 'string' ||
    typeof lastUpdated !== 'string' ||
    !Number.isFinite(Date.parse(lastUpdated)) ||
    (collapseEstimateUpdatedAt !== undefined &&
      (typeof collapseEstimateUpdatedAt !== 'string' ||
        !Number.isFinite(Date.parse(collapseEstimateUpdatedAt)))) ||
    (collapseDeadlineAt !== null &&
      collapseDeadlineAt !== undefined &&
      (typeof collapseDeadlineAt !== 'string' ||
        !Number.isFinite(Date.parse(collapseDeadlineAt)))) ||
    (underQuestion !== undefined && typeof underQuestion !== 'boolean') ||
    (observerVerifiedAt !== null &&
      observerVerifiedAt !== undefined &&
      (typeof observerVerifiedAt !== 'string' ||
        !Number.isFinite(Date.parse(observerVerifiedAt)))) ||
    !Array.isArray(eventLog)
  ) {
    return null;
  }

  const operation = parseOperation(pendingOperation);
  if (pendingOperation !== null && pendingOperation !== undefined && operation === null) {
    return null;
  }
  const parsedEvents = eventLog.map(parseEvent);
  if (parsedEvents.some((event) => event === null)) {
    return null;
  }
  if (currentStatus === 'collapsing' && !collapseDeadlineAt) {
    return null;
  }
  const legacyQuestion = currentStatus === 'under_review' && operation === null;
  const normalizedCollapseEstimateAt =
    typeof collapseEstimateUpdatedAt === 'string' ? collapseEstimateUpdatedAt : lastUpdated;
  const migratedBaseDrain =
    energyLevel /
    Math.max(timeToCollapseMinutes, 0.1) /
    (2 - stability / 100);
  const normalizedEvents = parsedEvents.filter(
    (event): event is PortalEvent => event !== null,
  );
  const legacyCollapseEvent =
    currentStatus === 'closed' && occupants > 0
      ? normalizedEvents.find((event) => event.action === 'natural_collapse')
      : undefined;
  const lostInLegacyIncident = legacyCollapseEvent ? occupants : 0;
  const existingIncidentEvent = normalizedEvents.find(
    (event) => event.action === 'collapse_incident',
  );
  const normalizedLostOccupants = Math.max(
    isNonNegativeInteger(lostOccupants) ? lostOccupants : 0,
    lostInLegacyIncident,
  );
  const normalizedEventsWithIncident: PortalEvent[] =
    legacyCollapseEvent && !existingIncidentEvent
    ? [
        {
          id: `${id}:collapse-incident-migration:${legacyCollapseEvent.timestamp}`,
          timestamp: legacyCollapseEvent.timestamp,
          portalId: id,
          action: 'collapse_incident',
          result: 'critical',
          description: `КРИТИЧЕСКОЕ ПРОИСШЕСТВИЕ: портал «${name}» схлопнулся ${new Date(legacyCollapseEvent.timestamp).toLocaleString('ru-RU')}; по старому журналу потеряны ${occupants} человек/существ. Требуется внимание.`,
        },
        ...normalizedEvents,
      ]
    : normalizedEvents;
  const inferredClosedAt =
    normalizedEvents.find(
      (event) =>
        event.action === 'close' ||
        event.action === 'natural_collapse' ||
        event.action === 'collapse_incident',
    )?.timestamp ?? lastUpdated;
  const inferredClosureReason: PortalClosureReason =
    currentStatus !== 'closed'
      ? 'unknown'
      : normalizedEvents.some((event) => event.action === 'collapse_incident')
        ? 'legacy_collapse'
        : normalizedEvents.some((event) => event.action === 'natural_collapse')
          ? 'legacy_collapse'
          : normalizedEvents.some((event) => event.action === 'close')
            ? 'manual_close'
            : 'unknown';

  return {
    id,
    name,
    destination,
    energyLevel,
    energyUpdatedAt:
      typeof energyUpdatedAt === 'string' ? energyUpdatedAt : normalizedCollapseEstimateAt,
    baseEnergyDrainPerMinute:
      isFiniteNumber(baseEnergyDrainPerMinute) && baseEnergyDrainPerMinute > 0
        ? baseEnergyDrainPerMinute
        : Math.max(migratedBaseDrain, 0.01),
    stability,
    timeToCollapseMinutes,
    collapseEstimateUpdatedAt: normalizedCollapseEstimateAt,
    collapseDeadlineAt:
      typeof collapseDeadlineAt === 'string' ? collapseDeadlineAt : null,
    occupants:
      currentStatus === 'closed' &&
      existingIncidentEvent !== undefined &&
      occupants === 0 &&
      normalizedLostOccupants > 0
        ? normalizedLostOccupants
        : occupants,
    lostOccupants: normalizedLostOccupants,
    incidentReviewedAt:
      typeof incidentReviewedAt === 'string' ? incidentReviewedAt : null,
    closedAt:
      currentStatus === 'closed'
        ? typeof closedAt === 'string'
          ? closedAt
          : inferredClosedAt
        : null,
    closureReason:
      currentStatus === 'closed'
        ? isPortalClosureReason(closureReason)
          ? closureReason
          : inferredClosureReason
        : null,
    currentStatus: legacyQuestion ? 'open' : currentStatus,
    notes,
    lastUpdated,
    pendingOperation: operation,
    underQuestion: underQuestion === true || legacyQuestion,
    observerVerifiedAt:
      typeof observerVerifiedAt === 'string' ? observerVerifiedAt : null,
    eventLog: normalizedEventsWithIncident,
  };
}

export function loadPortals(seed: Portal[]): PortalLoadResult {
  if (typeof window === 'undefined') {
    return {
      status: 'error',
      portals: seed,
      warning: 'Браузерное хранилище недоступно. Изменения не будут сохранены.',
    };
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return { status: 'missing', portals: seed, warning: null };
    }
    const parsed: unknown = JSON.parse(raw);
    const envelope = isPortalEnvelope(parsed) ? parsed : null;
    const rawPortals: unknown[] | null = envelope
      ? envelope.portals
      : Array.isArray(parsed)
        ? parsed
        : null;
    if (!rawPortals) {
      throw new Error('Сохранённые данные имеют неизвестный формат.');
    }
    const portals = rawPortals.map(parsePortal);
    if (portals.some((portal) => portal === null)) {
      throw new Error('В сохранённых данных есть некорректная запись портала.');
    }
    return {
      status: 'loaded',
      portals: portals.filter((portal): portal is Portal => portal !== null),
      warning: null,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Неизвестная ошибка чтения.';
    return {
      status: 'error',
      portals: seed,
      warning: `Не удалось безопасно прочитать сохранённые данные: ${detail} Исходные данные не изменены; записи временно заблокированы.`,
    };
  }
}

export function savePortals(portals: Portal[]): PortalSaveResult {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ schemaVersion: 1, portals }),
    );
    return { ok: true, error: null };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Неизвестная ошибка записи.';
    return { ok: false, error: `Не удалось сохранить изменения: ${detail}` };
  }
}
