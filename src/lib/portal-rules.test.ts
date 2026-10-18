import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ACCESS_THRESHOLDS,
  advancePortals,
  advanceDemoPortalCycles,
  applyPortalAction,
  calculateRisk,
  cancelPortalOperation,
  createPortal,
  DEFAULT_ENERGY_DRAIN_PER_MINUTE,
  DEMO_PORTAL_REOPEN_DELAY_MS,
  evaluatePortal,
  getExitStabilityWarning,
  getAccessDecision,
  getCollapseAt,
  getEnergyAt,
  getEnergyDrainRate,
  getRecommendedAction,
  getStabilizationPreview,
  getRiskLevel,
  OPERATION_DURATIONS_MS,
  OBSERVER_VISIT_DURATION_MS,
  recordBlockedAction,
  resetDemoPortals,
  RISK_THRESHOLDS,
  summarizePortals,
} from './portal-rules';
import { INITIAL_PORTALS } from '../data/initial-portals';
import type { Portal } from '../types';
import { loadPortals, savePortals, STORAGE_KEY } from './storage';

const now = Date.now();

const basePortal: Portal = {
  id: 'portal-01',
  name: 'Тестовый портал',
  destination: 'Альтория',
  energyLevel: 68,
  stability: 54,
  timeToCollapseMinutes: 38,
  collapseEstimateUpdatedAt: new Date(now).toISOString(),
  collapseDeadlineAt: null,
  occupants: 2,
  currentStatus: 'open',
  notes: 'Портал готов к проверке.',
  lastUpdated: new Date(now).toISOString(),
  pendingOperation: null,
  underQuestion: false,
  observerVerifiedAt: null,
  eventLog: [],
};

describe('модель риска и допуска', () => {
  it('рассчитывает 180 минут при полном запасе и стабильности', () => {
    const portal = createPortal({
      name: 'Полный запас',
      destination: 'Тихая долина',
      energyLevel: 100,
      stability: 100,
      occupants: 0,
    });

    expect(DEFAULT_ENERGY_DRAIN_PER_MINUTE).toBeCloseTo(100 / 180);
    expect(portal.baseEnergyDrainPerMinute).toBeCloseTo(100 / 180);
    expect(portal.timeToCollapseMinutes).toBeCloseTo(180);
  });

  it('сохраняет согласованность энергетической модели во всех стартовых демо-порталах', () => {
    for (const portal of INITIAL_PORTALS) {
      expect(portal.baseEnergyDrainPerMinute).toBeCloseTo(DEFAULT_ENERGY_DRAIN_PER_MINUTE);
      if (portal.currentStatus !== 'closed') {
        expect(portal.timeToCollapseMinutes).toBeCloseTo(
          portal.energyLevel /
            (DEFAULT_ENERGY_DRAIN_PER_MINUTE * (2 - portal.stability / 100)),
        );
      }
    }
    expect(INITIAL_PORTALS.find((portal) => portal.id === 'portal-j8')).toMatchObject({
      energyLevel: 100,
      stability: 100,
      timeToCollapseMinutes: 180,
    });
  });

  it('проверяет границы уровней риска', () => {
    expect(getRiskLevel(RISK_THRESHOLDS.moderate - 1)).toBe('low');
    expect(getRiskLevel(RISK_THRESHOLDS.moderate)).toBe('moderate');
    expect(getRiskLevel(RISK_THRESHOLDS.high)).toBe('high');
    expect(getRiskLevel(RISK_THRESHOLDS.critical)).toBe('critical');
  });

  it('запрещает повтор имени портала без учёта регистра и лишних пробелов', () => {
    const existing = { ...basePortal, name: 'Тестовый портал' };
    expect(() =>
      createPortal(
        {
          name: '  тестовый   портал ',
          destination: 'Тихая долина',
          energyLevel: 40,
          stability: 80,
          occupants: 0,
        },
        [existing],
      ),
    ).toThrow('названием уже существует');
  });

  it('помещает отметку «под вопросом» между высоким и средним риском в очереди внимания', () => {
    const high: Portal = {
      ...basePortal,
      id: 'high',
      name: 'Высокий риск',
      energyLevel: 20,
      stability: 60,
      timeToCollapseMinutes: 30,
      occupants: 0,
    };
    const questioned: Portal = {
      ...basePortal,
      id: 'questioned',
      name: 'Под вопросом',
      energyLevel: 80,
      stability: 90,
      timeToCollapseMinutes: 100,
      occupants: 0,
      underQuestion: true,
    };
    const moderate: Portal = {
      ...basePortal,
      id: 'moderate',
      name: 'Средний риск',
      energyLevel: 40,
      stability: 40,
      timeToCollapseMinutes: 180,
      occupants: 0,
    };

    expect(
      summarizePortals([moderate, questioned, high], now).attentionPortals.map(
        (portal) => portal.id,
      ),
    ).toEqual(['high', 'questioned', 'moderate']);
  });

  it('учитывает сокращение времени и количество находящихся внутри', () => {
    const safe = {
      ...basePortal,
      energyLevel: 40,
      stability: 90,
      occupants: 0,
      timeToCollapseMinutes: 60,
    };
    const crowdedShortWindow = {
      ...safe,
      occupants: 10,
      timeToCollapseMinutes: 1,
    };

    expect(calculateRisk(crowdedShortWindow, now)).toBeGreaterThan(
      calculateRisk(safe, now),
    );
    expect(getRiskLevel(calculateRisk(crowdedShortWindow, now))).toBe('critical');
  });

  it('повышает риск при снижении энергии при прочих равных', () => {
    const portal: Portal = {
      ...basePortal,
      occupants: 0,
      stability: 80,
      energyUpdatedAt: new Date(now).toISOString(),
      baseEnergyDrainPerMinute: 1,
    };
    const highEnergyRisk = calculateRisk({ ...portal, energyLevel: 80 }, now);
    const lowEnergyRisk = calculateRisk({ ...portal, energyLevel: 20 }, now);

    expect(lowEnergyRisk).toBeGreaterThan(highEnergyRisk);
  });

  it('разрешает, требует проверки или запрещает проход с учётом времени', () => {
    const allowed: Portal = {
      ...basePortal,
      energyLevel: 90,
      stability: 90,
      occupants: 0,
      timeToCollapseMinutes: 90,
    };
    const shortWindow = {
      ...allowed,
      timeToCollapseMinutes:
        ACCESS_THRESHOLDS.allowedMinCollapseWindowMinutes - 1,
    };
    const critical = {
      ...allowed,
      stability: 20,
      energyLevel: 20,
      occupants: 10,
      timeToCollapseMinutes: 10,
    };

    expect(getAccessDecision(allowed, now)).toBe('allowed');
    expect(getAccessDecision(shortWindow, now)).toBe('requires_check');
    expect(
      getAccessDecision({ ...allowed, timeToCollapseMinutes: 14 }, now),
    ).toBe('forbidden');
    expect(getAccessDecision(critical, now)).toBe('forbidden');
    expect(getAccessDecision({ ...allowed, currentStatus: 'closed' }, now)).toBe(
      'forbidden',
    );
    expect(getAccessDecision({ ...allowed, currentStatus: 'collapsing' }, now)).toBe(
      'forbidden',
    );
  });

  it('показывает активное схлопывание как критическое состояние и приоритет внимания', () => {
    const collapsing: Portal = {
      ...basePortal,
      currentStatus: 'collapsing',
      timeToCollapseMinutes: 0,
      collapseDeadlineAt: new Date(now + 45_000).toISOString(),
    };
    const summary = summarizePortals([basePortal, collapsing], now);

    expect(evaluatePortal(collapsing, now).riskLevel).toBe('critical');
    expect(summary.attentionPortals[0].id).toBe(collapsing.id);
    expect(summary.criticalRisk).toBe(1);
  });

  it('не считает закрытый портал активным риском и не выдаёт для него ETA', () => {
    const closed = {
      ...basePortal,
      currentStatus: 'closed' as const,
      energyLevel: 0,
      stability: 0,
      timeToCollapseMinutes: 0,
    };
    const evaluation = evaluatePortal(closed, now);

    expect(calculateRisk(closed, now)).toBe(0);
    expect(evaluation.riskScore).toBe(0);
    expect(evaluation.riskLevel).toBe('low');
    expect(evaluation.remainingSeconds).toBeNull();
    expect(evaluation.accessDecision).toBe('forbidden');
  });
});

describe('асинхронные операции', () => {
  it('задаёт интервал демо-цикла ровно в 2 часа 30 минут', () => {
    expect(DEMO_PORTAL_REOPEN_DELAY_MS).toBe(150 * 60_000);
  });

  it('перезапускает демо-портал через 2,5 часа и заменяет закрытую итерацию', () => {
    const template: Portal = {
      ...basePortal,
      id: 'demo-portal',
      currentStatus: 'open',
      pendingOperation: null,
      closedAt: null,
    };
    const closed: Portal = {
      ...template,
      currentStatus: 'closed',
      closedAt: new Date(now - DEMO_PORTAL_REOPEN_DELAY_MS).toISOString(),
      eventLog: [{
        id: 'closed-cycle-event',
        timestamp: new Date(now - DEMO_PORTAL_REOPEN_DELAY_MS).toISOString(),
        portalId: template.id,
        action: 'natural_collapse',
        result: 'completed',
        description: 'Закрытая итерация.',
      }],
    };

    const beforeDelay = advanceDemoPortalCycles(
      [closed],
      [template],
      now - 1,
    );
    expect(beforeDelay).toHaveLength(1);

    const reopened = advanceDemoPortalCycles([closed], [template], now);
    expect(reopened).toHaveLength(1);
    expect(reopened[0]).toMatchObject({
      id: 'demo-portal-cycle-1',
      currentStatus: 'open',
      pendingOperation: null,
      closedAt: null,
      occupants: template.occupants,
      energyUpdatedAt: new Date(now).toISOString(),
    });
    expect(reopened[0].eventLog.map((event) => event.id)).toContain(
      'closed-cycle-event',
    );
    expect(reopened[0].eventLog.at(-1)?.description).toContain('итерация 1');
    expect(reopened.some((portal) => portal.name === closed.name && portal.currentStatus === 'closed')).toBe(false);
    expect(advanceDemoPortalCycles(reopened, [template], now + 1)).toBe(reopened);
  });

  it('не удаляет непросмотренное происшествие ради автоматического цикла', () => {
    const template: Portal = {
      ...basePortal,
      id: 'demo-incident-portal',
      currentStatus: 'open',
      pendingOperation: null,
      closedAt: null,
    };
    const closed: Portal = {
      ...template,
      currentStatus: 'closed',
      closedAt: new Date(now - DEMO_PORTAL_REOPEN_DELAY_MS).toISOString(),
      lostOccupants: 1,
      incidentReviewedAt: null,
    };

    expect(advanceDemoPortalCycles([closed], [template], now)).toEqual([closed]);
    const reviewed = {
      ...closed,
      incidentReviewedAt: new Date(now - 1_000).toISOString(),
    };
    const reopened = advanceDemoPortalCycles([reviewed], [template], now);
    expect(reopened).toHaveLength(1);
    expect(reopened[0].currentStatus).toBe('open');
    expect(reopened[0].eventLog.slice(0, reviewed.eventLog.length)).toEqual(
      reviewed.eventLog,
    );
    expect(reopened[0].eventLog.at(-1)?.description).toContain('итерация 1');
  });

  it('не перезапускает созданные пользователем порталы', () => {
    const userPortal: Portal = {
      ...basePortal,
      id: 'user-created-portal',
      currentStatus: 'closed',
      closedAt: new Date(now - DEMO_PORTAL_REOPEN_DELAY_MS * 2).toISOString(),
    };

    const portals = [userPortal];
    expect(advanceDemoPortalCycles(portals, [basePortal], now)).toBe(portals);
  });

  it('восстанавливает демо-данные с обновлёнными временными отметками', () => {
    const inProgress: Portal = {
      ...basePortal,
      eventLog: [
        {
          id: 'pending-test-event',
          timestamp: new Date(now - 30_000).toISOString(),
          portalId: basePortal.id,
          action: 'stabilize',
          result: 'in_progress',
          description: 'Стабилизация выполняется.',
        },
      ],
      pendingOperation: {
        kind: 'stabilize',
        startedAt: new Date(now - 30_000).toISOString(),
        completesAt: new Date(now + 90_000).toISOString(),
        previousStatus: 'open',
      },
    };
    const restored = resetDemoPortals([inProgress], now)[0];

    expect(restored.pendingOperation).toBeNull();
    expect(restored.energyUpdatedAt).toBe(new Date(now).toISOString());
    expect(restored.collapseEstimateUpdatedAt).toBe(new Date(now).toISOString());
    expect(restored.eventLog[0].timestamp).toBe(new Date(now).toISOString());
    expect(restored.energyLevel).toBe(inProgress.energyLevel);
    expect(restored.stability).toBe(inProgress.stability);
  });

  it('расходует энергию и пересчитывает прогноз после завершения стабилизации', () => {
    const portal: Portal = {
      ...basePortal,
      energyLevel: 80,
      stability: 50,
      occupants: 0,
      timeToCollapseMinutes: 80 / 1.5,
      energyUpdatedAt: new Date(now).toISOString(),
      baseEnergyDrainPerMinute: 1,
    };
    const started = applyPortalAction(portal, 'stabilize', { now });
    expect(started.pendingOperation?.kind).toBe('stabilize');
    expect(started.stability).toBe(portal.stability);
    expect(started.eventLog[0].result).toBe('in_progress');
    expect(getRecommendedAction(started)).toContain('Стабилизация выполняется');

    const completed = advancePortals(
      [started],
      Date.parse(started.pendingOperation!.completesAt),
    )[0];
    expect(completed.pendingOperation).toBeNull();
    expect(completed.stability).toBe(70);
    expect(completed.energyLevel).toBeCloseTo(65);
    expect(getEnergyDrainRate(completed)).toBeCloseTo(1.3);
    expect(getCollapseAt(completed)! - Date.parse(completed.energyUpdatedAt!)).toBeCloseTo(
      (65 / 1.3) * 60_000,
    );
  });

  it('восстанавливает незавершённую операцию и учитывает время после загрузки сохранения', () => {
    const portal: Portal = {
      ...basePortal,
      energyLevel: 80,
      stability: 50,
      occupants: 0,
      energyUpdatedAt: new Date(now).toISOString(),
      baseEnergyDrainPerMinute: 1,
    };
    const started = applyPortalAction(portal, 'stabilize', { now });
    expect(savePortals([started]).ok).toBe(true);
    const restored = loadPortals([]).portals[0];
    const halfway = advancePortals([restored], now + 60_000)[0];

    expect(halfway.pendingOperation?.kind).toBe('stabilize');
    expect(getEnergyAt(halfway, now + 60_000)).toBeCloseTo(78.5);

    const completed = advancePortals(
      [halfway],
      Date.parse(started.pendingOperation!.completesAt),
    )[0];
    expect(completed.pendingOperation).toBeNull();
    expect(completed.energyLevel).toBeCloseTo(65);
    expect(completed.stability).toBe(70);
  });

  it('снижает скорость расхода энергии при повышении стабильности', () => {
    const stable: Portal = {
      ...basePortal,
      occupants: 0,
      energyLevel: 80,
      stability: 100,
      timeToCollapseMinutes: 80,
      energyUpdatedAt: new Date(now).toISOString(),
      baseEnergyDrainPerMinute: 1,
    };
    const unstable = { ...stable, stability: 50 };
    expect(getEnergyDrainRate(stable)).toBe(1);
    expect(getEnergyDrainRate(unstable)).toBe(1.5);
    expect(getEnergyAt(stable, now + 60_000)).toBeCloseTo(79);
    expect(getEnergyAt(unstable, now + 60_000)).toBeCloseTo(78.5);
    expect(getCollapseAt(stable)! - now).toBe(80 * 60_000);
    expect(getCollapseAt(unstable)! - now).toBeCloseTo((80 / 1.5) * 60_000);
  });

  it('показывает прогноз стабилизации и запрещает её при недостаточном запасе', () => {
    const enough = {
      ...basePortal,
      energyLevel: 50,
      stability: 70,
      occupants: 0,
      timeToCollapseMinutes: 50 / 1.3,
      energyUpdatedAt: new Date(now).toISOString(),
      baseEnergyDrainPerMinute: 1,
    };
    const preview = getStabilizationPreview(enough, now);
    expect(preview.possible).toBe(true);
    expect(preview.energyAfter).toBeCloseTo(35.4);
    expect(preview.stabilityAfter).toBe(90);
    expect(() =>
      applyPortalAction(
        { ...enough, energyLevel: 10, timeToCollapseMinutes: 10 / 1.3 },
        'stabilize',
        { now },
      ),
    ).toThrow('Недостаточно энергии');
  });

  it('позволяет отменить стабилизацию без изменения технических значений', () => {
    const started = applyPortalAction(basePortal, 'stabilize');
    const cancelled = cancelPortalOperation(started);

    expect(cancelled.pendingOperation).toBeNull();
    expect(cancelled.stability).toBe(basePortal.stability);
    expect(cancelled.energyLevel).toBe(basePortal.energyLevel);
    expect(cancelled.eventLog[0].action).toBe('cancel_operation');
  });

  it('закрывает портал через минуту и позволяет отменить закрытие', () => {
    const started = applyPortalAction(basePortal, 'close', {
      confirmClose: true,
      now,
    });
    expect(started.currentStatus).toBe('open');
    expect(started.pendingOperation?.kind).toBe('close');
    expect(started.pendingOperation?.startedAt).toBe(new Date(now).toISOString());
    expect(
      Date.parse(started.pendingOperation!.completesAt) -
        Date.parse(started.pendingOperation!.startedAt),
    ).toBe(OPERATION_DURATIONS_MS.close);

    const cancelled = cancelPortalOperation(started);
    expect(cancelled.currentStatus).toBe('open');
    expect(cancelled.pendingOperation).toBeNull();

    const startedAgain = applyPortalAction(basePortal, 'close', { confirmClose: true });
    const closed = advancePortals(
      [startedAgain],
      Date.parse(startedAgain.pendingOperation!.completesAt),
    )[0];
    expect(closed.currentStatus).toBe('closed');
    expect(closed.occupants).toBe(basePortal.occupants);
    expect(closed.closedAt).toBe(startedAgain.pendingOperation!.completesAt);
    expect(closed.closureReason).toBe('manual_close');
  });

  it('предупреждает и требует подтверждение, если внутри есть люди', () => {
    expect(() => applyPortalAction(basePortal, 'close')).toThrow(
      'Внутри остаются существа или люди.',
    );
  });

  it('переключает отметку «под вопросом» и записывает оба изменения', () => {
    const started = applyPortalAction(basePortal, 'mark_under_review', { now });
    expect(started.currentStatus).toBe('open');
    expect(started.underQuestion).toBe(true);
    expect(started.eventLog[0].timestamp).toBe(new Date(now).toISOString());
    expect(started.eventLog[0].description).toContain('помечен');
    const cleared = applyPortalAction(started, 'mark_under_review');
    expect(cleared.underQuestion).toBe(false);
    expect(cleared.eventLog[0].description).toContain('снята');
  });

  it('наблюдатель входит на 5 минут, учитывается внутри, возвращается и снимает требование проверки', () => {
    const needsCheck: Portal = {
      ...basePortal,
      energyLevel: 20,
      stability: 90,
      occupants: 0,
      timeToCollapseMinutes: 30,
    };
    expect(getAccessDecision(needsCheck, now)).toBe('requires_check');

    const started = applyPortalAction(needsCheck, 'send_observer');
    expect(started.pendingOperation?.kind).toBe('observer');
    expect(started.occupants).toBe(1);
    expect(started.stability).toBe(89);
    expect(
      Date.parse(started.pendingOperation!.completesAt) -
        Date.parse(started.pendingOperation!.startedAt),
    ).toBe(OBSERVER_VISIT_DURATION_MS);

    const returned = advancePortals(
      [started],
      Date.parse(started.pendingOperation!.completesAt),
    )[0];
    expect(returned.pendingOperation).toBeNull();
    expect(returned.occupants).toBe(0);
    expect(returned.stability).toBe(88);
    expect(returned.observerVerifiedAt).not.toBeNull();
    expect(getAccessDecision(returned, Date.parse(returned.observerVerifiedAt!))).toBe('allowed');
    const admitted = applyPortalAction(returned, 'record_occupant_entry', {
      occupantCount: 1,
      now: Date.parse(returned.observerVerifiedAt!),
    });
    expect(admitted.occupants).toBe(1);
    expect(
      getAccessDecision(admitted, Date.parse(returned.observerVerifiedAt!)),
    ).toBe('allowed');
  });

  it('пускает наблюдателя в высокий, но не критический риск; блокирует критический риск и короткий таймер', () => {
    const high: Portal = {
      ...basePortal,
      energyLevel: 30,
      stability: 40,
      occupants: 5,
      timeToCollapseMinutes: 60,
    };
    expect(getRiskLevel(calculateRisk(high, now))).toBe('high');
    expect(getAccessDecision(high, now)).toBe('forbidden');
    expect(applyPortalAction(high, 'send_observer').pendingOperation?.kind).toBe('observer');
    expect(() =>
      applyPortalAction(high, 'record_occupant_entry', { occupantCount: 1 }),
    ).toThrow('Вход запрещён');

    const critical: Portal = {
      ...basePortal,
      energyLevel: 20,
      stability: 12,
      occupants: 8,
      timeToCollapseMinutes: 5,
    };
    expect(() => applyPortalAction(critical, 'send_observer')).toThrow();
    const blocked = recordBlockedAction(critical, 'send_observer', 'Вход запрещён.');
    expect(blocked.eventLog[0].result).toBe('blocked');
    expect(() =>
      applyPortalAction({ ...high, timeToCollapseMinutes: 14 }, 'send_observer'),
    ).toThrow('не менее 15 минут');
  });

  it('отмена визита наблюдателя немедленно возвращает его и уменьшает число внутри', () => {
    const started = applyPortalAction(basePortal, 'send_observer');
    const cancelled = cancelPortalOperation(started);
    expect(cancelled.pendingOperation).toBeNull();
    expect(cancelled.occupants).toBe(basePortal.occupants);
    expect(cancelled.eventLog[0].description).toContain('досрочно вернулся');
  });

  it('не отменяет операцию после её завершения, даже до следующего обновления интерфейса', () => {
    const needsCheck: Portal = {
      ...basePortal,
      energyLevel: 80,
      stability: 90,
      occupants: 0,
      timeToCollapseMinutes: 80,
      energyUpdatedAt: new Date(now).toISOString(),
      baseEnergyDrainPerMinute: 1,
    };
    const started = applyPortalAction(needsCheck, 'send_observer', { now });
    const completesAt = Date.parse(started.pendingOperation!.completesAt);
    const afterCompletion = cancelPortalOperation(started, completesAt + 1_000);

    expect(afterCompletion.pendingOperation).toBeNull();
    expect(afterCompletion.occupants).toBe(0);
    expect(afterCompletion.observerVerifiedAt).toBe(new Date(completesAt).toISOString());
    expect(afterCompletion.eventLog[0].action).toBe('send_observer');
    expect(afterCompletion.eventLog[0].result).toBe('completed');
    expect(afterCompletion.eventLog.some((event) => event.action === 'cancel_operation')).toBe(false);
  });

  it('не позволяет отменой операции избежать уже наступившего схлопывания', () => {
    const startedAt = now;
    const startTime = new Date(startedAt).toISOString();
    const closing: Portal = {
      ...basePortal,
      energyLevel: 0.5,
      energyUpdatedAt: startTime,
      baseEnergyDrainPerMinute: 1,
      stability: 100,
      occupants: 2,
      currentStatus: 'open',
      pendingOperation: {
        kind: 'close',
        startedAt: startTime,
        completesAt: new Date(startedAt + OPERATION_DURATIONS_MS.close).toISOString(),
        previousStatus: 'open',
      },
    };
    const afterDeadline = cancelPortalOperation(
      closing,
      startedAt + OPERATION_DURATIONS_MS.close,
    );

    expect(afterDeadline.currentStatus).toBe('closed');
    expect(afterDeadline.pendingOperation).toBeNull();
    expect(afterDeadline.occupants).toBe(2);
    expect(afterDeadline.lostOccupants).toBe(2);
    expect(afterDeadline.eventLog[0].action).toBe('collapse_incident');
    expect(afterDeadline.eventLog.some((event) => event.action === 'cancel_operation')).toBe(false);
  });

  it('считает наблюдателя оставшимся по другую сторону при схлопывании во время визита', () => {
    const startedAt = new Date(now).toISOString();
    const visiting: Portal = {
      ...basePortal,
      energyLevel: 1,
      stability: 54,
      occupants: 2,
      energyUpdatedAt: startedAt,
      baseEnergyDrainPerMinute: 1,
      pendingOperation: {
        kind: 'observer',
        startedAt,
        completesAt: new Date(now + OBSERVER_VISIT_DURATION_MS).toISOString(),
        previousStatus: 'open',
      },
    };
    const closed = advancePortals([visiting], now + 2 * 60_000)[0];

    expect(closed.currentStatus).toBe('closed');
    expect(closed.pendingOperation).toBeNull();
    expect(closed.occupants).toBe(2);
    expect(closed.lostOccupants).toBe(2);
    expect(closed.eventLog[0].action).toBe('collapse_incident');
    expect(closed.eventLog[0].description).toContain('потеряны 2');
  });

  it('не позволяет случайно списать наблюдателя как обычный выход', () => {
    const solo = {
      ...basePortal,
      occupants: 0,
      energyLevel: 90,
      stability: 100,
      timeToCollapseMinutes: 90,
    };
    const visiting = applyPortalAction(solo, 'send_observer');
    expect(() =>
      applyPortalAction(visiting, 'record_occupant_exit', { occupantCount: 1 }),
    ).toThrow('наблюдатель ещё не вернулся');
  });

  it('фиксирует выход указанного количества и пересчитывает риск', () => {
    const occupied = {
      ...basePortal,
      occupants: 3,
      timeToCollapseMinutes: 1,
      collapseEstimateUpdatedAt: new Date(now).toISOString(),
    };
    const beforeRisk = calculateRisk(occupied, now);
    const afterExit = applyPortalAction(occupied, 'record_occupant_exit', {
      occupantCount: 2,
    });

    expect(afterExit.occupants).toBe(1);
    expect(afterExit.eventLog[0]).toMatchObject({
      action: 'record_occupant_exit',
      result: 'completed',
    });
    expect(calculateRisk(afterExit, now)).toBeLessThan(beforeRisk);
    expect(() =>
      applyPortalAction(afterExit, 'record_occupant_exit', { occupantCount: 2 }),
    ).toThrow('внутри только 1.');
  });

  it('фиксирует несколько вошедших только если проход разрешён до и после входа', () => {
    const safe: Portal = {
      ...basePortal,
      energyLevel: 90,
      stability: 100,
      occupants: 0,
      timeToCollapseMinutes: 180,
      collapseEstimateUpdatedAt: new Date(now).toISOString(),
    };
    const entered = applyPortalAction(safe, 'record_occupant_entry', {
      occupantCount: 5,
    });
    expect(entered.occupants).toBe(5);
    expect(entered.stability).toBe(95);
    expect(entered.eventLog[0].description).toContain('вход 5');

    expect(() =>
      applyPortalAction({ ...safe, stability: 20 }, 'record_occupant_entry', {
        occupantCount: 1,
      }),
    ).toThrow('Вход запрещён');
    expect(() =>
      applyPortalAction(safe, 'record_occupant_entry', { occupantCount: 0 }),
    ).toThrow('положительное целое число');
    expect(() =>
      applyPortalAction({ ...safe, occupants: 1 }, 'record_occupant_entry', {
        occupantCount: Number.MAX_SAFE_INTEGER,
        now,
      }),
    ).toThrow('безопасный диапазон');
    expect(() =>
      applyPortalAction(safe, 'record_occupant_entry', {
        occupantCount: Number.MAX_SAFE_INTEGER + 1,
        now,
      }),
    ).toThrow('положительное целое число');
  });

  it('немедленно закрывает портал при исчерпании энергии без дополнительного окна', () => {
    const expiring: Portal = {
      ...basePortal,
      energyLevel: 0,
      energyUpdatedAt: new Date(now - 5_000).toISOString(),
      baseEnergyDrainPerMinute: 1,
      timeToCollapseMinutes: 0,
      occupants: 3,
    };
    const closed = advancePortals([expiring], now)[0];
    expect(closed.currentStatus).toBe('closed');
    expect(closed.collapseDeadlineAt).toBeNull();
    expect(closed.occupants).toBe(3);
    expect(closed.lostOccupants).toBe(3);
    expect(closed.eventLog[0]).toMatchObject({
      portalId: expiring.id,
      action: 'collapse_incident',
      result: 'critical',
      timestamp: new Date(now - 5_000).toISOString(),
    });
    expect(closed.eventLog[0].description).toContain(expiring.name);
    expect(closed.eventLog[0].description).toContain('потеряны 3');
    expect(closed.eventLog[0].description).toContain(
      new Date(now - 5_000).toLocaleString('ru-RU'),
    );

    const processedAgain = advancePortals([closed], now + 60_000)[0];
    expect(processedAgain).toBe(closed);
    expect(processedAgain.lostOccupants).toBe(3);
    expect(processedAgain.eventLog.filter((event) => event.action === 'collapse_incident')).toHaveLength(1);
    const summary = summarizePortals([processedAgain], now);
    expect(summary.openPortals).toBe(0);
    expect(summary.closedPortals).toBe(1);
    expect(summary.attentionPortals).toEqual([processedAgain]);
  });

  it('фиксирует оставшихся как потерянных, если выход снижает стабильность до нуля', () => {
    const unstable = {
      ...basePortal,
      energyLevel: 80,
      stability: 1,
      occupants: 3,
      energyUpdatedAt: new Date(now).toISOString(),
      baseEnergyDrainPerMinute: 1,
    };
    const closed = applyPortalAction(unstable, 'record_occupant_exit', {
      occupantCount: 1,
    });

    expect(closed.currentStatus).toBe('closed');
    expect(closed.occupants).toBe(2);
    expect(closed.lostOccupants).toBe(2);
    expect(closed.stability).toBe(0);
    expect(closed.eventLog[0]).toMatchObject({
      action: 'collapse_incident',
      result: 'critical',
    });
    expect(closed.eventLog[0].description).toContain('потеряны 2');
    expect(closed.eventLog[1].action).toBe('record_occupant_exit');
  });

  it('предупреждает о низкой стабильности и схлопывании после выхода', () => {
    const unstable = { ...basePortal, stability: 5, occupants: 10 };

    expect(getExitStabilityWarning(unstable, 1)).toEqual({
      kind: 'low_stability',
      stabilityAfter: 4,
    });
    expect(getExitStabilityWarning(unstable, 4)).toEqual({
      kind: 'low_stability',
      stabilityAfter: 1,
    });
    expect(getExitStabilityWarning(unstable, 5)).toEqual({
      kind: 'collapse',
      stabilityAfter: 0,
    });
    expect(getExitStabilityWarning(unstable, 6)).toBeNull();
  });

  it('отклоняет выход, если запрошенное число превышает запас стабильности', () => {
    const unstable = { ...basePortal, stability: 5, occupants: 10 };

    expect(() =>
      applyPortalAction(unstable, 'record_occupant_exit', { occupantCount: 6 }),
    ).toThrow('текущей стабильности 5% хватает максимум на 5 проходов');
  });

  it('схлопывает по рассчитанному времени и регистрирует оставшихся без окна задержки', () => {
    const expiring: Portal = {
      ...basePortal,
      energyLevel: 1,
      stability: 100,
      occupants: 2,
      energyUpdatedAt: new Date(now).toISOString(),
      baseEnergyDrainPerMinute: 1,
      timeToCollapseMinutes: 1,
    };
    const collapseAt = getCollapseAt(expiring)!;
    const collapsed = advancePortals([expiring], collapseAt)[0];

    expect(collapsed.currentStatus).toBe('closed');
    expect(collapsed.occupants).toBe(2);
    expect(collapsed.lostOccupants).toBe(2);
    expect(collapsed.eventLog[0].result).toBe('critical');
    expect(Date.parse(collapsed.eventLog[0].timestamp)).toBe(collapseAt);
  });

  it('при схлопывании без людей закрывает портал без происшествия', () => {
    const empty: Portal = {
      ...basePortal,
      energyLevel: 0,
      energyUpdatedAt: new Date(now).toISOString(),
      baseEnergyDrainPerMinute: 1,
      occupants: 0,
    };
    const closed = advancePortals([empty], now)[0];

    expect(closed.currentStatus).toBe('closed');
    expect(closed.occupants).toBe(0);
    expect(closed.lostOccupants).toBe(0);
    expect(closed.eventLog[0]).toMatchObject({
      action: 'natural_collapse',
      result: 'completed',
    });
    expect(closed.eventLog.some((event) => event.action === 'collapse_incident')).toBe(false);
    expect(summarizePortals([closed], now).attentionPortals).toHaveLength(0);
  });

  it('не разрешает проход через портал, уже имеющий нулевую стабильность', () => {
    const unstable = {
      ...basePortal,
      energyLevel: 80,
      stability: 0,
      occupants: 2,
      energyUpdatedAt: new Date(now).toISOString(),
      baseEnergyDrainPerMinute: 1,
    };
    expect(() =>
      applyPortalAction(unstable, 'record_occupant_exit', { occupantCount: 1 }),
    ).toThrow('Портал уже достиг порога схлопывания');
    expect(advancePortals([unstable], now)[0].currentStatus).toBe('closed');
    expect(() => applyPortalAction(unstable, 'stabilize', { now })).toThrow(
      'достиг порога немедленного схлопывания',
    );
  });

  it('схлопывает сохранённое старое состояние без задержки', () => {
    const legacyCollapsing: Portal = {
      ...basePortal,
      energyLevel: 0,
      currentStatus: 'collapsing',
      collapseDeadlineAt: new Date(now + 60_000).toISOString(),
    };
    const closed = advancePortals([legacyCollapsing], now)[0];
    expect(closed.currentStatus).toBe('closed');
    expect(closed.collapseDeadlineAt).toBeNull();
    expect(closed.occupants).toBe(2);
    expect(closed.lostOccupants).toBe(2);
    expect(closed.eventLog[0].result).toBe('critical');
    expect(closed.eventLog[0].description).toContain('потеряны 2');
  });

  it('не фиксирует выход из сохранённого состояния схлопывания', () => {
    const legacyCollapsing: Portal = {
      ...basePortal,
      energyLevel: 40,
      stability: 70,
      currentStatus: 'collapsing',
      collapseDeadlineAt: new Date(now + 60_000).toISOString(),
    };

    expect(() =>
      applyPortalAction(legacyCollapsing, 'record_occupant_exit', {
        occupantCount: 1,
        now,
      }),
    ).toThrow('уже закрыт или схлопывается');
  });

  it('не позволяет начинать стабилизацию после исчерпания энергии', () => {
    const almostCollapsed: Portal = {
      ...basePortal,
      occupants: 0,
      energyLevel: 0,
      energyUpdatedAt: new Date(now).toISOString(),
      baseEnergyDrainPerMinute: 1,
      timeToCollapseMinutes: 0,
    };
    expect(() => applyPortalAction(almostCollapsed, 'stabilize')).toThrow(
      'достиг порога немедленного схлопывания',
    );
  });

  it('сохраняет проверку риска, журнал и сводку при нескольких порталах', () => {
    const stable = { ...basePortal, occupants: 0, stability: 90, energyLevel: 20 };
    const critical = {
      ...basePortal,
      id: 'critical',
      stability: 12,
      energyLevel: 20,
      timeToCollapseMinutes: 1,
      occupants: 10,
    };
    const summary = summarizePortals([stable, critical], now);
    expect(summary.openPortals).toBe(2);
    expect(summary.criticalRisk).toBe(1);
    expect(summary.attentionPortals[0].id).toBe('critical');
  });

  it('создаёт запись портала с начальным событием', () => {
    const created = createPortal({
      name: 'Новый шлюз',
      destination: 'Тихая долина',
      energyLevel: 40,
      stability: 80,
      occupants: 0,
    });
    expect(created.eventLog[0].action).toBe('create_portal');
    expect(
      createPortal({
        name: 'Без энергии',
        destination: 'Пустота',
        energyLevel: 0,
        stability: 80,
        occupants: 0,
      }).currentStatus,
    ).toBe('closed');
    expect(
      createPortal({
        name: 'Без стабильности',
        destination: 'Пустота',
        energyLevel: 80,
        stability: 0,
        occupants: 0,
      }).currentStatus,
    ).toBe('closed');
    expect(() =>
      createPortal({
        name: ' ',
        destination: '',
        energyLevel: 101,
        stability: 80,
        occupants: 0,
      }),
    ).toThrow();
    expect(() =>
      createPortal({
        name: 'Слишком много',
        destination: 'Пустота',
        energyLevel: 80,
        stability: 80,
        occupants: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toThrow();
  });
});

describe('хранилище порталов', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('сохраняет и затем читает пустой список как валидное состояние', () => {
    expect(savePortals([]).ok).toBe(true);
    expect(loadPortals([basePortal])).toMatchObject({
      status: 'loaded',
      portals: [],
    });
  });

  it('мигрирует сохранённый стартовый портал на новую базовую скорость', () => {
    const template = INITIAL_PORTALS.find((portal) => portal.id === 'portal-j8')!;
    const previousVersion = {
      ...template,
      energyLevel: 100,
      stability: 100,
      baseEnergyDrainPerMinute: 1,
      timeToCollapseMinutes: 100,
    };
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ schemaVersion: 1, portals: [previousVersion] }),
    );

    const loaded = loadPortals(INITIAL_PORTALS).portals[0];
    expect(loaded.baseEnergyDrainPerMinute).toBeCloseTo(DEFAULT_ENERGY_DRAIN_PER_MINUTE);
    expect(loaded.timeToCollapseMinutes).toBeCloseTo(180);
  });

  it('при загрузке удаляет закрытый архивный дубль и сохраняет его события у активного портала', () => {
    const closed: Portal = {
      ...basePortal,
      id: 'portal-closed-cycle',
      currentStatus: 'closed',
      closedAt: new Date(now - 60_000).toISOString(),
      eventLog: [{
        id: 'closed-cycle-incident',
        timestamp: new Date(now - 60_000).toISOString(),
        portalId: 'portal-closed-cycle',
        action: 'collapse_incident',
        result: 'critical',
        description: 'Происшествие старой итерации.',
      }],
    };
    const active: Portal = {
      ...basePortal,
      name: `  ${basePortal.name.toLocaleUpperCase('ru-RU')}  `,
    };
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ schemaVersion: 1, portals: [closed, active] }),
    );

    const loaded = loadPortals([]);
    expect(loaded.portals).toHaveLength(1);
    expect(loaded.portals[0].currentStatus).toBe('open');
    expect(loaded.portals[0].eventLog.map((event) => event.id)).toContain(
      'closed-cycle-incident',
    );
  });

  it('при очистке дублей сохраняет закрытый портал с непросмотренной потерей в очереди происшествий', () => {
    const timestamp = new Date(now).toISOString();
    const closed: Portal = {
      ...basePortal,
      id: 'unreviewed-closed',
      currentStatus: 'closed',
      closedAt: timestamp,
      lostOccupants: 1,
      incidentReviewedAt: null,
      eventLog: [{
        id: 'unreviewed-incident-event',
        timestamp,
        portalId: 'unreviewed-closed',
        action: 'collapse_incident',
        result: 'critical',
        description: 'Потерян 1 человек/существо.',
      }],
    };
    const active: Portal = {
      ...basePortal,
      id: 'same-name-active',
      name: ` ${basePortal.name.toLocaleUpperCase('ru-RU')} `,
      lastUpdated: new Date(now + 1_000).toISOString(),
    };
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ schemaVersion: 1, portals: [active, closed] }),
    );

    const loaded = loadPortals([]);
    expect(loaded.portals).toHaveLength(1);
    expect(loaded.portals[0].id).toBe('unreviewed-closed');
    expect(summarizePortals(loaded.portals, now).attentionPortals).toHaveLength(1);
  });

  it('добавляет новые поля наблюдения при чтении старого формата сохранённых порталов', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(
        { schemaVersion: 1, portals: [basePortal] },
        (key, value: unknown) =>
          key === 'underQuestion' || key === 'observerVerifiedAt' ? undefined : value,
      ),
    );

    expect(loadPortals([])).toMatchObject({
      status: 'loaded',
      portals: [
        {
          underQuestion: false,
          observerVerifiedAt: null,
          energyUpdatedAt: basePortal.collapseEstimateUpdatedAt,
        },
      ],
    });
    const migrated = loadPortals([]).portals[0];
    expect(migrated.baseEnergyDrainPerMinute).toBeCloseTo(
      basePortal.energyLevel /
        basePortal.timeToCollapseMinutes /
        (2 - basePortal.stability / 100),
    );
  });

  it('мигрирует старое схлопывание с оставшимися внутри в критическое происшествие один раз', () => {
    const collapseTimestamp = new Date(now - 60_000).toISOString();
    const legacyCollapsed: Portal = {
      ...basePortal,
      currentStatus: 'closed',
      occupants: 4,
      eventLog: [
        {
          id: 'legacy-collapse',
          timestamp: collapseTimestamp,
          portalId: basePortal.id,
          action: 'natural_collapse',
          result: 'warning',
          description: 'Портал схлопнулся; внутри оставалось 4 человек/существ.',
        },
      ],
    };
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 1,
        portals: [legacyCollapsed],
      }),
    );

    const migrated = loadPortals([]).portals[0];
    expect(migrated.occupants).toBe(4);
    expect(migrated.lostOccupants).toBe(4);
    expect(migrated.eventLog.filter((event) => event.action === 'collapse_incident')).toHaveLength(1);
    expect(migrated.eventLog[0]).toMatchObject({
      result: 'critical',
      timestamp: collapseTimestamp,
    });
  });

  it('восстанавливает число оставшихся из старого счётчика потерь и не дублирует происшествие', () => {
    const incidentTimestamp = new Date(now - 30_000).toISOString();
    const previousVersionPortal: Portal = {
      ...basePortal,
      currentStatus: 'closed',
      occupants: 0,
      lostOccupants: 3,
      eventLog: [
        {
          id: 'existing-collapse-incident',
          timestamp: incidentTimestamp,
          portalId: basePortal.id,
          action: 'collapse_incident',
          result: 'critical',
          description: 'Критическое происшествие: потеряны 3 человек/существ.',
        },
      ],
    };
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ schemaVersion: 1, portals: [previousVersionPortal] }),
    );

    const migrated = loadPortals([]).portals[0];
    expect(migrated.occupants).toBe(3);
    expect(migrated.lostOccupants).toBe(3);
    expect(migrated.eventLog.filter((event) => event.action === 'collapse_incident')).toHaveLength(1);

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ schemaVersion: 1, portals: [migrated] }),
    );
    const loadedAgain = loadPortals([]).portals[0];
    expect(loadedAgain.occupants).toBe(3);
    expect(loadedAgain.lostOccupants).toBe(3);
    expect(loadedAgain.eventLog.filter((event) => event.action === 'collapse_incident')).toHaveLength(1);
  });

  it('исключает закрытые записи из текущего риска и очереди риска', () => {
    const closedCritical: Portal = {
      ...basePortal,
      currentStatus: 'closed',
      energyLevel: 0,
      stability: 0,
      occupants: 2,
      lostOccupants: 2,
    };
    const summary = summarizePortals([closedCritical], now);
    expect(summary.criticalRisk).toBe(0);
    expect(summary.openPortals).toBe(0);
    expect(summary.closedPortals).toBe(1);
    expect(summary.attentionPortals).toEqual([closedCritical]);
    expect(
      summarizePortals(
        [{ ...closedCritical, incidentReviewedAt: new Date(now).toISOString() }],
        now,
      ).attentionPortals,
    ).toEqual([]);
  });

  it('не затирает повреждённую запись начальными данными', () => {
    window.localStorage.setItem(STORAGE_KEY, '{bad json');
    const result = loadPortals([basePortal]);
    expect(result.status).toBe('error');
    expect(result.warning).toContain('Исходные данные не изменены');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('{bad json');
  });

  it('отклоняет сохранённые счётчики, выходящие за безопасный целочисленный диапазон', () => {
    const invalidPortal = {
      ...basePortal,
      occupants: Number.MAX_SAFE_INTEGER + 1,
    };
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ schemaVersion: 1, portals: [invalidPortal] }),
    );

    expect(loadPortals([]).status).toBe('error');
  });

  it('возвращает ошибки чтения и записи хранилища', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage denied');
    });
    expect(loadPortals([basePortal]).warning).toContain('storage denied');

    vi.restoreAllMocks();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(savePortals([basePortal]).error).toContain('quota exceeded');
  });
});
