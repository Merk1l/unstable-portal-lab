import { useEffect, useMemo, useState, type FormEvent } from 'react';

import { INITIAL_PORTALS } from './data/initial-portals';
import {
  advancePortals,
  advanceDemoPortalCycles,
  applyPortalAction,
  cancelPortalOperation,
  createPortal,
  DEFAULT_ENERGY_DRAIN_PER_MINUTE,
  evaluatePortal,
  getEnergyAt,
  getEnergyDrainRate,
  getEnergyDrainMultiplier,
  getRecommendedAction,
  getStabilizationPreview,
  normalizePortalName,
  OPERATION_DURATIONS_MS,
  recordBlockedAction,
  resetDemoPortals,
  summarizePortals,
} from './lib/portal-rules';
import { loadPortals, savePortals } from './lib/storage';
import type { Portal, PortalAction, PortalDraft, PortalEvent } from './types';

type Screen = 'overview' | 'archive' | 'journal' | 'worklog';
type PersistenceMode = 'persistent' | 'blocked_read' | 'blocked_write' | 'memory_only';
type OccupantAdjustment = {
  portalId: string;
  action: 'record_occupant_entry' | 'record_occupant_exit';
  count: string;
};
type CloseConfirmation = { portalId: string; name: string; occupants: number };
const DEMO_CYCLE_DELAY_LABEL = '2 ч 30 мин';
const APP_START_TIME = Date.now();

const actionLabels: Record<PortalAction, string> = {
  stabilize: 'Стабилизировать',
  close: 'Закрыть портал',
  send_observer: 'Отправить наблюдателя',
  record_occupant_exit: 'Зафиксировать выход',
  record_occupant_entry: 'Зафиксировать вход',
  mark_under_review: 'Пометить под вопросом',
  cancel_operation: 'Отменить операцию',
  natural_collapse: 'Схлопывание',
  collapse_incident: 'Происшествие при схлопывании',
  create_portal: 'Добавить портал',
};

const riskLabels = {
  low: 'Низкий',
  moderate: 'Средний',
  high: 'Высокий',
  critical: 'Критический',
} as const;

const riskStyles = {
  low: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-500/40',
  moderate: 'bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-500/40',
  high: 'bg-orange-500/15 text-orange-300 ring-1 ring-inset ring-orange-500/40',
  critical: 'bg-rose-500/15 text-rose-300 ring-1 ring-inset ring-rose-500/40',
} as const;

const eventResultLabels: Record<PortalEvent['result'], string> = {
  completed: 'Завершено',
  blocked: 'Отклонено',
  warning: 'Требует внимания',
  critical: 'Критическое происшествие · требует внимания',
  pending_review: 'Проверка ожидает',
  in_progress: 'Выполняется',
};

const emptyDraft: PortalDraft = {
  name: '',
  destination: '',
  energyLevel: 50,
  stability: 70,
  occupants: 0,
};

function formatTimestamp(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
    : 'Время неизвестно';
}

function formatDuration(seconds: number | null) {
  if (seconds === null) {
    return 'Закрыт';
  }
  if (seconds <= 0) {
    return '0:00';
  }
  const wholeSeconds = Math.ceil(seconds);
  if (wholeSeconds < 60) {
    return `${wholeSeconds} сек`;
  }
  const minutes = Math.floor(wholeSeconds / 60);
  const remainder = String(wholeSeconds % 60).padStart(2, '0');
  return `${minutes}:${remainder}`;
}

function closureReasonLabel(reason: Portal['closureReason']) {
  switch (reason) {
    case 'manual_close':
      return 'Закрыт смотрителем';
    case 'energy_depleted':
      return 'Энергия исчерпана';
    case 'stability_depleted':
      return 'Стабильность достигла 0%';
    case 'legacy_collapse':
      return 'Схлопнулся (историческая запись)';
    default:
      return 'Причина не указана';
  }
}

function App() {
  const [initialData] = useState(() => loadPortals(INITIAL_PORTALS));
  const [portals, setPortals] = useState<Portal[]>(initialData.portals);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialData.portals[0]?.id ?? null,
  );
  const [screen, setScreen] = useState<Screen>('overview');
  const [notice, setNotice] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState(initialData.warning);
  const [persistenceMode, setPersistenceMode] = useState<PersistenceMode>(
    initialData.status === 'error' ? 'blocked_read' : 'persistent',
  );
  const [now, setNow] = useState(APP_START_TIME);
  const [draft, setDraft] = useState<PortalDraft>(emptyDraft);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [occupantAdjustment, setOccupantAdjustment] = useState<OccupantAdjustment | null>(null);
  const [closeConfirmation, setCloseConfirmation] = useState<CloseConfirmation | null>(null);
  const [resetConfirmation, setResetConfirmation] = useState(false);
  const [archiveSelectedId, setArchiveSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const clock = window.setInterval(() => {
      setNow(Date.now());
      const tickTime = Date.now();
      setPortals((current) => {
        const advanced = advancePortals(current, tickTime);
        return advanceDemoPortalCycles(advanced, INITIAL_PORTALS, tickTime);
      });
    }, 1_000);
    return () => window.clearInterval(clock);
  }, []);

  useEffect(() => {
    if (persistenceMode !== 'persistent') {
      return;
    }
    const saveTimer = window.setTimeout(() => {
      const result = savePortals(portals);
      if (!result.ok) {
        setPersistenceMode('blocked_write');
        setStorageWarning(
          `${result.error} Текущие данные останутся в памяти; операции приостановлены до вашего решения.`,
        );
      } else {
        setStorageWarning(null);
      }
    }, 0);
    return () => window.clearTimeout(saveTimer);
  }, [portals, persistenceMode]);

  const activePortals = useMemo(
    () => portals.filter((portal) => portal.currentStatus !== 'closed'),
    [portals],
  );
  const archivedPortals = useMemo(
    () => portals.filter((portal) => portal.currentStatus === 'closed'),
    [portals],
  );
  const selectedPortal =
    activePortals.find((portal) => portal.id === selectedId) ??
    activePortals[0] ??
    null;
  const selectedArchive =
    archivedPortals.find((portal) => portal.id === archiveSelectedId) ??
    archivedPortals[0] ??
    null;
  const selectedEvaluation = selectedPortal ? evaluatePortal(selectedPortal, now) : null;
  const stabilizationPreview =
    selectedPortal?.pendingOperation?.kind === 'stabilize'
      ? getStabilizationPreview(
          selectedPortal,
          now,
          Math.max(0, Date.parse(selectedPortal.pendingOperation.completesAt) - now),
        )
      : null;
  const summary = useMemo(
    () => summarizePortals(portals, now),
    [portals, now],
  );
  const duplicatePortalName = portals.some(
    (portal) => normalizePortalName(portal.name) === normalizePortalName(draft.name),
  );
  const unreviewedIncidents = summary.attentionPortals.filter(
    (portal) =>
      portal.currentStatus === 'closed' &&
      (portal.lostOccupants ?? 0) > 0 &&
      !portal.incidentReviewedAt,
  );
  const operationalAttentionPortals = summary.attentionPortals.filter(
    (portal) => !unreviewedIncidents.includes(portal),
  );
  const sortedPortals = useMemo(
    () =>
      [...activePortals].sort(
        (left, right) =>
          evaluatePortal(right, now).riskScore - evaluatePortal(left, now).riskScore,
      ),
    [activePortals, now],
  );
  const allEvents = useMemo(
    () =>
      portals
        .flatMap((portal) =>
          portal.eventLog.map((event) => ({ ...event, portalName: portal.name })),
        )
        .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp)),
    [portals],
  );
  const isReadOnly =
    persistenceMode === 'blocked_read' || persistenceMode === 'blocked_write';
  const noticeIsRejection = notice?.startsWith('Действие отклонено:') ?? false;

  const persist = (nextPortals: Portal[]) => {
    setPortals(nextPortals);
  };

  const openIncidentArchive = (portal: Portal) => {
    setArchiveSelectedId(portal.id);
    setScreen('archive');
    if (!portal.incidentReviewedAt) {
      persist(
        portals.map((item) =>
          item.id === portal.id
            ? { ...item, incidentReviewedAt: new Date().toISOString() }
            : item,
        ),
      );
    }
  };

  const updatePortal = (
    portal: Portal,
    action: PortalAction,
    occupantCount?: number,
    confirmedClose = false,
  ) => {
    if (isReadOnly) {
      setNotice('Операции приостановлены: восстановите хранилище или явно выберите работу без сохранения.');
      return;
    }
    if (action === 'close' && portal.occupants > 0 && !confirmedClose) {
      setCloseConfirmation({
        portalId: portal.id,
        name: portal.name,
        occupants: portal.occupants,
      });
      return;
    }
    try {
      const updated = applyPortalAction(portal, action, {
        confirmClose: confirmedClose,
        occupantCount,
      });
      persist(portals.map((item) => (item.id === portal.id ? updated : item)));
      if (action === 'close') {
        setCloseConfirmation(null);
      }
      if (action === 'send_observer') {
        setNotice('Наблюдатель вошёл в портал на 5 минут; его учитывают среди находящихся внутри.');
        return;
      }
      if (action === 'record_occupant_exit') {
        setOccupantAdjustment(null);
        setNotice(`Зафиксирован фактический выход ${occupantCount} человек/существ; внутри осталось ${updated.occupants}.`);
        return;
      }
      if (action === 'record_occupant_entry') {
        setOccupantAdjustment(null);
        setNotice(`Зафиксирован фактический вход ${occupantCount} человек/существ; внутри теперь ${updated.occupants}.`);
        return;
      }
      if (action === 'mark_under_review') {
        setNotice(
          updated.underQuestion
            ? `Портал «${portal.name}» помечен «под вопросом».`
            : `Отметка «под вопросом» для портала «${portal.name}» снята.`,
        );
        return;
      }
      const duration = OPERATION_DURATIONS_MS[
        action === 'stabilize' ? 'stabilize' : action === 'close' ? 'close' : 'review'
      ];
      setNotice(
        `${actionLabels[action]}: операция началась и займёт ${Math.round(duration / 60_000)} мин. Её можно отменить до завершения.`,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Неизвестная ошибка операции.';
      const blocked = recordBlockedAction(portal, action, reason);
      persist(portals.map((item) => (item.id === portal.id ? blocked : item)));
      setNotice(`Действие отклонено: ${reason}. Попытка записана в журнал.`);
    }
  };

  const cancelOperation = (portal: Portal) => {
    if (isReadOnly) {
      setNotice('Операции приостановлены до восстановления хранилища или выбора режима без сохранения.');
      return;
    }
    try {
      const updated = cancelPortalOperation(portal);
      persist(portals.map((item) => (item.id === portal.id ? updated : item)));
      if (updated.currentStatus === 'closed') {
        setNotice('Операцию отменить не удалось: портал уже схлопнулся и закрыт.');
      } else if (updated.eventLog[0]?.action !== 'cancel_operation') {
        setNotice('Операция уже завершилась; её результат сохранён.');
      } else {
        setNotice('Операция отменена. Если портал уже начал схлопываться, таймер схлопывания продолжится.');
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Не удалось отменить операцию.');
    }
  };

  const submitOccupantAdjustment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!occupantAdjustment || !selectedPortal || occupantAdjustment.portalId !== selectedPortal.id) {
      return;
    }
    updatePortal(selectedPortal, occupantAdjustment.action, Number(occupantAdjustment.count));
  };

  const handleCreatePortal = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isReadOnly) {
      setNotice('Создание приостановлено до восстановления хранилища или выбора режима без сохранения.');
      return;
    }
    try {
      const portal = createPortal(draft, portals);
      persist([...portals, portal]);
      setSelectedId(portal.id);
      setScreen('overview');
      setDraft(emptyDraft);
      setShowCreateForm(false);
      setNotice(`Портал «${portal.name}» добавлен; операция внесена в журнал.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Не удалось создать запись портала.');
    }
  };

  const retryStorageRead = () => {
    const result = loadPortals(INITIAL_PORTALS);
    if (result.status === 'error') {
      setStorageWarning(result.warning);
      return;
    }
    setPortals(result.portals);
    setSelectedId(result.portals[0]?.id ?? null);
    setPersistenceMode('persistent');
    setStorageWarning(null);
    setNotice('Хранилище перечитано; загружено последнее сохранённое состояние.');
  };

  const retryPendingWrite = () => {
    const result = savePortals(portals);
    if (!result.ok) {
      setStorageWarning(`${result.error} Изменения остаются в памяти.`);
      return;
    }
    setPersistenceMode('persistent');
    setStorageWarning(null);
    setNotice('Изменения сохранены.');
  };

  const useMemoryOnly = () => {
    setPersistenceMode('memory_only');
    setStorageWarning(
      'Работа без сохранения: содержимое localStorage не меняется, а новые изменения будут потеряны после перезагрузки.',
    );
    setNotice('Включён режим работы без сохранения.');
  };

  const restoreDemoData = () => {
    if (isReadOnly) {
      setNotice('Восстановление приостановлено: восстановите хранилище или явно выберите работу без сохранения.');
      return;
    }
    const restored = resetDemoPortals(INITIAL_PORTALS);
    persist(restored);
    setSelectedId(restored.find((portal) => portal.currentStatus !== 'closed')?.id ?? null);
    setArchiveSelectedId(null);
    setOccupantAdjustment(null);
    setCloseConfirmation(null);
    setResetConfirmation(false);
    setShowCreateForm(false);
    setScreen('overview');
    setNotice('Демонстрационные данные восстановлены, временные отметки обновлены.');
  };

  const actionConfig = selectedPortal && selectedEvaluation
    ? [
        {
          action: 'stabilize' as const,
          disabled:
            isReadOnly ||
            selectedPortal.currentStatus === 'closed' ||
            selectedPortal.currentStatus === 'collapsing' ||
            selectedPortal.stability <= 0 ||
            getEnergyAt(selectedPortal, now) <= 0 ||
            Boolean(selectedPortal.pendingOperation),
        },
        {
          action: 'close' as const,
          disabled:
            isReadOnly ||
            selectedPortal.currentStatus === 'closed' ||
            selectedPortal.currentStatus === 'collapsing' ||
            Boolean(selectedPortal.pendingOperation),
        },
        {
          action: 'send_observer' as const,
          disabled:
            isReadOnly ||
            selectedPortal.currentStatus === 'closed' ||
            selectedPortal.currentStatus === 'collapsing' ||
            Boolean(selectedPortal.pendingOperation),
        },
        {
          action: 'mark_under_review' as const,
          disabled:
            isReadOnly ||
            selectedPortal.currentStatus === 'closed' ||
            Boolean(selectedPortal.pendingOperation),
        },
      ]
    : [];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-6 rounded-3xl border border-slate-800 bg-slate-900/80 p-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-cyan-300">
                Монитор лаборатории
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">
                Безопасность порталов
              </h1>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setResetConfirmation(true)}
                disabled={isReadOnly}
                className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 hover:border-amber-400/60 hover:text-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Восстановить демо-данные
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft(emptyDraft);
                  setShowCreateForm(true);
                }}
                disabled={isReadOnly}
                className="rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Добавить портал
              </button>
            </div>
          </div>

          {storageWarning && (
            <div
              role="alert"
              className="mt-5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
            >
              <p>{storageWarning}</p>
              {persistenceMode === 'blocked_read' && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={retryStorageRead} className="rounded-lg border border-amber-300/40 px-3 py-1.5 font-medium">
                    Повторить чтение
                  </button>
                  <button type="button" onClick={useMemoryOnly} className="rounded-lg border border-amber-300/40 px-3 py-1.5 font-medium">
                    Продолжить без сохранения
                  </button>
                </div>
              )}
              {persistenceMode === 'blocked_write' && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={retryPendingWrite} className="rounded-lg border border-amber-300/40 px-3 py-1.5 font-medium">
                    Повторить сохранение
                  </button>
                  <button type="button" onClick={useMemoryOnly} className="rounded-lg border border-amber-300/40 px-3 py-1.5 font-medium">
                    Продолжить без сохранения
                  </button>
                </div>
              )}
            </div>
          )}
          {notice && (
            <p
              role={noticeIsRejection ? 'alert' : 'status'}
              className={`mt-4 rounded-xl border px-4 py-3 text-sm ${
                noticeIsRejection
                  ? 'border-rose-500/50 bg-rose-500/10 text-rose-100'
                  : 'border-cyan-500/40 bg-cyan-500/10 text-cyan-100'
              }`}
            >
              {noticeIsRejection && <strong className="mr-1">Действие отклонено.</strong>}
              {noticeIsRejection ? notice.replace(/^Действие отклонено:\s*/, '') : notice}
            </p>
          )}
          <nav aria-label="Разделы" className="mt-6 flex flex-wrap gap-2 border-t border-slate-800 pt-4">
            {([
              ['overview', 'Обзор'],
              ['archive', `Архив (${archivedPortals.length})`],
              ['journal', 'Журнал событий'],
              ['worklog', 'AI Worklog'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-current={screen === value ? 'page' : undefined}
                onClick={() => setScreen(value)}
                className={`rounded-xl px-4 py-2 text-sm font-medium ${screen === value ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-800'}`}
              >
                {label}
              </button>
            ))}
          </nav>
        </header>

        {screen === 'overview' && (
          <>
            <p className="mb-4 text-sm text-slate-400">
              За минуту: выберите портал, изучите риск и очередь внимания, пометьте запись «под вопросом» и запустите визит наблюдателя. Наблюдатель учитывается внутри 5 минут; визит можно отменить.
            </p>
            <p className="mb-4 text-xs text-slate-500">
              Стартовые демо-порталы циклично открываются через {DEMO_CYCLE_DELAY_LABEL}; если есть непросмотренное происшествие, сначала откройте его. Новая итерация заменяет старую запись в архиве, события остаются в журнале.
            </p>
            <section aria-label="Сводка" className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                { label: 'Открытые порталы', value: summary.openPortals, color: 'text-cyan-300' },
                { label: 'Критический риск', value: summary.criticalRisk, color: 'text-rose-300' },
                { label: 'Закрытые порталы', value: summary.closedPortals, color: 'text-violet-300' },
                { label: 'Требуют внимания', value: summary.attentionPortals.length, color: 'text-amber-300' },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-400">{item.label}</p>
                  <p className={`mt-2 text-3xl font-bold ${item.color}`}>{item.value}</p>
                </div>
              ))}
            </section>

            {unreviewedIncidents.length > 0 && (
              <section
                aria-label="Очередь критических происшествий"
                className="mb-6 rounded-2xl border border-rose-500/40 bg-slate-900/80 p-5"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h2 className="text-lg font-semibold text-white">Критические происшествия</h2>
                  <span className="text-sm text-rose-200">
                    Требуют просмотра · {unreviewedIncidents.length}
                  </span>
                </div>
                <ol className="mt-4 grid gap-3 lg:grid-cols-3">
                  {unreviewedIncidents.map((portal, index) => (
                    <li key={portal.id}>
                      <button
                        type="button"
                        onClick={() => openIncidentArchive(portal)}
                        className="h-full w-full rounded-xl border border-rose-500/30 bg-slate-950/60 p-4 text-left hover:border-rose-400/70"
                      >
                        <p className="text-xs uppercase tracking-[0.15em] text-slate-500">
                          Происшествие {index + 1}
                        </p>
                        <p className="mt-2 font-semibold text-white">{portal.name}</p>
                        <p className="mt-1 text-sm text-rose-200">
                          Потеряны {portal.lostOccupants}; требуется внимание
                        </p>
                        <p className="mt-2 text-xs text-slate-400">
                          {formatTimestamp(portal.closedAt ?? portal.lastUpdated)}
                        </p>
                        <p className="mt-2 text-sm text-cyan-200">
                          Открыть архивную запись происшествия
                        </p>
                      </button>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            <section className="mb-6 rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="text-lg font-semibold text-white">Очередь внимания</h2>
                <span className="text-sm text-slate-400">Схлопывания, риск и время</span>
              </div>
              {operationalAttentionPortals.length > 0 ? (
                <ol className="mt-4 grid gap-3 lg:grid-cols-3">
                  {operationalAttentionPortals.map((portal, index) => {
                    const evaluation = evaluatePortal(portal, now);
                    return (
                      <li key={portal.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(portal.id)}
                          className="h-full w-full rounded-xl border border-slate-700 bg-slate-950/60 p-4 text-left hover:border-cyan-500/60"
                        >
                          <p className="text-xs uppercase tracking-[0.15em] text-slate-500">Приоритет {index + 1}</p>
                          <p className="mt-2 font-semibold text-white">{portal.name}</p>
                          <p className="mt-1 text-sm text-slate-300">
                            {riskLabels[evaluation.riskLevel]} риск · {formatDuration(evaluation.remainingSeconds)} · внутри: {portal.occupants}
                          </p>
                          <p className="mt-2 text-sm leading-5 text-cyan-200">
                            {getRecommendedAction(portal, now)}
                          </p>
                          {portal.underQuestion && (
                            <p className="mt-2 text-xs font-medium text-amber-200">
                              Отмечен «под вопросом» · обратите внимание.
                            </p>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="mt-3 text-sm text-slate-300">Активных порталов, требующих срочного внимания, нет.</p>
              )}
            </section>

            {activePortals.length === 0 ? (
              <section className="rounded-3xl border border-slate-800 bg-slate-900/80 p-8">
                <h2 className="text-2xl font-semibold text-white">Нет активных порталов</h2>
                <p className="mt-3 max-w-2xl text-slate-300">Закрытые записи хранятся в архиве. Добавьте новый портал или откройте архив.</p>
                <button
                  type="button"
                  onClick={() => setShowCreateForm(true)}
                  disabled={isReadOnly}
                  className="mt-5 rounded-xl bg-cyan-500 px-4 py-2 font-semibold text-slate-950 disabled:opacity-50"
                >
                  Добавить портал
                </button>
                {archivedPortals.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setScreen('archive')}
                    className="ml-2 mt-5 rounded-xl border border-slate-700 px-4 py-2 font-semibold text-slate-200"
                  >
                    Открыть архив
                  </button>
                )}
              </section>
            ) : (
              <main className="grid gap-6 xl:grid-cols-[0.95fr_2fr]">
                <aside
                  aria-label="Список порталов по убыванию риска"
                  className="rounded-3xl border border-slate-800 bg-slate-900/80 p-4"
                >
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-white">Порталы</h2>
                    <span className="rounded-full border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-300">
                      {activePortals.length}
                    </span>
                  </div>
                  <div className="space-y-3">
                    {sortedPortals.map((portal) => {
                      const evaluation = evaluatePortal(portal, now);
                      return (
                        <button
                          key={portal.id}
                          type="button"
                          onClick={() => {
                            setSelectedId(portal.id);
                            setOccupantAdjustment(null);
                          }}
                          className={`w-full rounded-2xl border p-4 text-left transition hover:border-cyan-500/60 ${selectedPortal?.id === portal.id ? 'border-cyan-500/70 bg-slate-800/90' : 'border-slate-800 bg-slate-950/50'}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-semibold text-white">{portal.name}</p>
                              <p className="text-sm text-slate-400">{portal.destination}</p>
                              <p className="mt-1 text-xs text-slate-400">
                                {portal.currentStatus === 'open' ? 'Открыт' : portal.currentStatus === 'under_review' ? 'Проверяется' : 'Схлопывается'}
                                {portal.underQuestion && ' · Под вопросом'}
                              </p>
                            </div>
                            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${riskStyles[evaluation.riskLevel]}`}>
                              {riskLabels[evaluation.riskLevel]}
                            </span>
                          </div>
                          <div className="mt-4 grid grid-cols-3 gap-2 text-sm text-slate-300">
                            <span>Риск {evaluation.riskScore}</span>
                            <span>Стаб. {portal.stability}%</span>
                            <span>{formatDuration(evaluation.remainingSeconds)}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </aside>

                {selectedPortal && selectedEvaluation && (
                  <section className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
                    <div className="flex flex-col gap-4 border-b border-slate-800 pb-5 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Карточка портала</p>
                        <h2 className="mt-2 text-2xl font-semibold text-white">{selectedPortal.name}</h2>
                        <p className="mt-1 text-slate-300">Мир назначения: {selectedPortal.destination}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-sm text-slate-200">
                          {selectedPortal.currentStatus === 'open' ? 'Открыт' : selectedPortal.currentStatus === 'under_review' ? 'Проверяется' : selectedPortal.currentStatus === 'collapsing' ? 'Схлопывается' : 'Закрыт'}
                        </span>
                        {selectedPortal.underQuestion && (
                          <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-sm text-amber-200">
                            Под вопросом
                          </span>
                        )}
                        <span className={`rounded-full px-3 py-1 text-sm font-medium ${riskStyles[selectedEvaluation.riskLevel]}`}>
                          {riskLabels[selectedEvaluation.riskLevel]} риск · {selectedEvaluation.riskScore}/100
                        </span>
                      </div>
                    </div>

                    <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                      {[
                        ['Запас энергии', `${Math.floor(getEnergyAt(selectedPortal, now))}%`],
                        ['Стабильность', `${selectedPortal.stability}%`],
                        [
                          'До схлопывания',
                          formatDuration(selectedEvaluation.remainingSeconds),
                        ],
                        ['Находятся внутри', String(selectedPortal.occupants)],
                      ].map(([label, value]) => (
                        <div key={label} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                          <p className="text-xs uppercase tracking-[0.14em] text-slate-500">{label}</p>
                          <p className="mt-2 text-xl font-bold text-white">{value}</p>
                        </div>
                      ))}
                    </div>
                    {selectedPortal.currentStatus !== 'closed' && (
                      <p className="mt-3 text-xs text-slate-400">
                        Расход сейчас: {getEnergyDrainRate(selectedPortal).toFixed(2)} п.п./мин
                        {' '}· при снижении стабильности запас расходуется быстрее.
                      </p>
                    )}

                    {selectedPortal.pendingOperation && (
                      <div className="mt-5 rounded-xl border border-cyan-500/40 bg-cyan-500/10 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="font-semibold text-cyan-100">
                              {actionLabels[
                                selectedPortal.pendingOperation.kind === 'review'
                                  ? 'mark_under_review'
                                  : selectedPortal.pendingOperation.kind === 'observer'
                                    ? 'send_observer'
                                    : selectedPortal.pendingOperation.kind
                              ]}
                              {' '}— выполняется
                            </p>
                            <p className="mt-1 text-sm text-cyan-100/80">
                              До завершения: {formatDuration(Math.max(0, (Date.parse(selectedPortal.pendingOperation.completesAt) - now) / 1000))}
                              {stabilizationPreview &&
                                (stabilizationPreview.possible
                                  ? ` · прогноз после: ${formatDuration(stabilizationPreview.minutesAfter * 60)}, энергия ${Math.floor(stabilizationPreview.energyAfter)}%, стабильность ${stabilizationPreview.stabilityAfter}%`
                                  : ' · энергии не хватит, стабилизация будет прервана')}
                              {selectedPortal.pendingOperation.kind === 'observer' && ' · наблюдатель учитывается внутри'}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => cancelOperation(selectedPortal)}
                            disabled={isReadOnly}
                            className="rounded-lg border border-cyan-200/40 px-3 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-500/10 disabled:opacity-50"
                          >
                            Отменить
                          </button>
                        </div>
                      </div>
                    )}

                    {selectedPortal.currentStatus === 'collapsing' && (
                      <div role="alert" className="mt-5 rounded-xl border border-rose-500/50 bg-rose-500/10 p-4 text-rose-100">
                        <p className="font-semibold">Портал схлопывается немедленно</p>
                        <p className="mt-1 text-sm">
                        Запас энергии исчерпан или стабильность достигла 0%. Дополнительной задержки до закрытия нет. Внутри: {selectedPortal.occupants}.
                        </p>
                      </div>
                    )}

                    <div className="mt-5 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                      <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Допуск к проходу</p>
                        <p className={`mt-2 font-semibold ${selectedEvaluation.accessDecision === 'allowed' ? 'text-emerald-300' : selectedEvaluation.accessDecision === 'requires_check' ? 'text-amber-300' : 'text-rose-300'}`}>
                          {selectedEvaluation.accessDecision === 'allowed' ? 'Разрешён' : selectedEvaluation.accessDecision === 'requires_check' ? 'Требует проверки' : 'Запрещён'}
                        </p>
                        <p className="mt-3 text-xs uppercase tracking-[0.18em] text-slate-500">Рекомендация</p>
                        <p className="mt-2 text-sm leading-6 text-slate-200">{getRecommendedAction(selectedPortal, now)}</p>
                        <p className="mt-3 text-sm leading-6 text-slate-400">{selectedPortal.notes}</p>
                        <p className="mt-3 border-t border-slate-800 pt-3 text-xs leading-5 text-slate-500">
                          Риск учитывает энергию, нестабильность, время до схлопывания и число находящихся внутри.
                        </p>
                        <details className="mt-2 text-xs leading-5 text-slate-400">
                          <summary className="cursor-pointer font-medium text-slate-300">Формула и вклад находящихся внутри</summary>
                          <p className="mt-2">
                            Балл 0–100: 30% истощения запаса энергии + 25% нестабильности + 20% срочности времени + 25% экспозиции.
                            Энергетический вклад растёт при уменьшении остатка запаса; стабильность влияет на скорость расхода. Срочность растёт по мере уменьшения расчётного времени до схлопывания (калибровка — 180 минут).
                          </p>
                          <p className="mt-2">
                            Экспозиция = min(100, число внутри × 10 / max(минут до схлопывания, 0,1)).
                            Например, 10 внутри и 1 минута дают 25 баллов из 100 за экспозицию.
                            Если внутри есть люди, осталось не более 2 минут и экспозиция ≥75, итоговый риск как минимум критический — 75.
                          </p>
                        </details>
                      </div>

                      <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Операции</p>
                        <div className="mt-3 space-y-2">
                          {actionConfig.map(({ action, disabled }) => (
                            <button
                              key={action}
                              type="button"
                              onClick={() => updatePortal(selectedPortal, action)}
                              disabled={disabled}
                              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-left text-sm font-medium text-slate-100 transition hover:border-cyan-500/60 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {action === 'mark_under_review' && selectedPortal.underQuestion
                                ? 'Снять отметку «под вопросом»'
                                : actionLabels[action]}
                            </button>
                          ))}
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setOccupantAdjustment({
                                  portalId: selectedPortal.id,
                                  action: 'record_occupant_exit',
                                  count: '1',
                                })
                              }
                              disabled={
                                isReadOnly ||
                                selectedPortal.currentStatus === 'closed' ||
                                selectedPortal.occupants <=
                                  (selectedPortal.pendingOperation?.kind === 'observer' ? 1 : 0)
                              }
                              className="rounded-xl border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-left text-sm font-medium text-amber-100 transition hover:border-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {actionLabels.record_occupant_exit}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setOccupantAdjustment({
                                  portalId: selectedPortal.id,
                                  action: 'record_occupant_entry',
                                  count: '1',
                                })
                              }
                              disabled={
                                isReadOnly ||
                                selectedPortal.currentStatus !== 'open' ||
                                selectedEvaluation.accessDecision !== 'allowed' ||
                                Boolean(selectedPortal.pendingOperation)
                              }
                              className="rounded-xl border border-cyan-500/50 bg-cyan-500/10 px-3 py-2 text-left text-sm font-medium text-cyan-100 transition hover:border-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {actionLabels.record_occupant_entry}
                            </button>
                          </div>
                          {occupantAdjustment?.portalId === selectedPortal.id && (
                            <form
                              onSubmit={submitOccupantAdjustment}
                              className="rounded-xl border border-slate-700 bg-slate-950/80 p-3"
                            >
                              <label
                                htmlFor="occupant-adjustment-count"
                                className="block text-sm font-medium text-slate-200"
                              >
                                Сколько {occupantAdjustment.action === 'record_occupant_entry' ? 'вошло' : 'вышло'}?
                              </label>
                              <div className="mt-2 flex gap-2">
                                <input
                                  id="occupant-adjustment-count"
                                  type="number"
                                  min="1"
                                  max={
                                    occupantAdjustment.action === 'record_occupant_exit'
                                      ? selectedPortal.occupants -
                                        (selectedPortal.pendingOperation?.kind === 'observer' ? 1 : 0)
                                      : undefined
                                  }
                                  step="1"
                                  required
                                  value={occupantAdjustment.count}
                                  onChange={(event) =>
                                    setOccupantAdjustment({
                                      ...occupantAdjustment,
                                      count: event.target.value,
                                    })
                                  }
                                  className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                                />
                                <button
                                  type="submit"
                                  className="rounded-lg bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950"
                                >
                                  Зафиксировать
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setOccupantAdjustment(null)}
                                  className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200"
                                >
                                  Отмена
                                </button>
                              </div>
                              <p className="mt-2 text-xs leading-5 text-slate-500">
                                Указывайте только фактически состоявшийся проход. Обычный вход доступен только при допуске «разрешён»; если нужна проверка, сначала дождитесь возвращения наблюдателя.
                              </p>
                            </form>
                          )}
                          <p className="text-xs leading-5 text-slate-500">
                            Изменение числа находящихся внутри сразу влияет на оценку риска; само перемещение приложение не моделирует.
                          </p>
                          <p className="text-xs leading-5 text-slate-500">
                            При отметке «требует проверки» отправьте наблюдателя: это реальный 5-минутный визит внутрь, не осмотр снаружи. На время визита он добавляется к числу находящихся внутри; при возвращении вычитается.
                          </p>
                          <p className="text-xs leading-5 text-slate-500">
                            После возвращения обычный проход может быть разрешён на 30 минут, только если риск остаётся низким/средним, стабильность не ниже 35%, а до схлопывания не менее 15 минут. Сам балл риска от наблюдения не уменьшается.
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <h3 className="font-semibold text-white">История портала</h3>
                        <span className="text-xs text-slate-500">{selectedPortal.eventLog.length} событий</span>
                      </div>
                      <EventList events={selectedPortal.eventLog} />
                    </div>
                  </section>
                )}
              </main>
            )}
          </>
        )}

        {screen === 'archive' && (
          <section className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
            <div className="mb-5">
              <h2 className="text-xl font-semibold text-white">Архив закрытых порталов</h2>
              <p className="mt-1 text-sm text-slate-400">Исторические записи. Архив не обновляет таймеры и не меняет состояние порталов.</p>
            </div>
            {archivedPortals.length === 0 ? (
              <p className="rounded-xl border border-slate-800 bg-slate-950/60 p-5 text-sm text-slate-300">
                Закрытых порталов пока нет.
              </p>
            ) : (
              <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
                <nav aria-label="Закрытые порталы" className="space-y-2">
                  {archivedPortals.map((portal) => (
                    <button
                      key={portal.id}
                      type="button"
                      onClick={() => setArchiveSelectedId(portal.id)}
                      aria-current={selectedArchive?.id === portal.id ? 'true' : undefined}
                      className={`w-full rounded-xl border p-4 text-left ${selectedArchive?.id === portal.id ? 'border-cyan-500/60 bg-slate-800' : 'border-slate-800 bg-slate-950/50'}`}
                    >
                      <span className="block font-semibold text-white">{portal.name}</span>
                      <span className="mt-1 block text-xs text-slate-400">Закрыт · {formatTimestamp(portal.closedAt ?? portal.lastUpdated)}</span>
                      {(portal.lostOccupants ?? 0) > 0 && (
                        <span className="mt-2 block text-sm font-medium text-rose-300">Происшествие · требуется внимание</span>
                      )}
                    </button>
                  ))}
                </nav>
                {selectedArchive && (
                  <article className="rounded-2xl border border-slate-800 bg-slate-950/50 p-5">
                    <div className="border-b border-slate-800 pb-4">
                      <p className="text-xs uppercase tracking-wider text-slate-500">Историческая запись · портал закрыт</p>
                      <h3 className="mt-2 text-2xl font-semibold text-white">{selectedArchive.name}</h3>
                      <p className="mt-1 text-sm text-slate-400">ID: {selectedArchive.id} · Мир: {selectedArchive.destination}</p>
                    </div>
                    <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div>
                        <dt className="text-xs uppercase tracking-wider text-slate-500">Время закрытия</dt>
                        <dd className="mt-1 text-sm text-slate-200">{formatTimestamp(selectedArchive.closedAt ?? selectedArchive.lastUpdated)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs uppercase tracking-wider text-slate-500">Причина</dt>
                        <dd className="mt-1 text-sm text-slate-200">{closureReasonLabel(selectedArchive.closureReason)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs uppercase tracking-wider text-slate-500">Запас энергии на момент закрытия</dt>
                        <dd className="mt-1 text-sm text-slate-200">{Math.floor(selectedArchive.energyLevel)}%</dd>
                      </div>
                      <div>
                        <dt className="text-xs uppercase tracking-wider text-slate-500">Стабильность на момент закрытия</dt>
                        <dd className="mt-1 text-sm text-slate-200">{selectedArchive.stability}%</dd>
                      </div>
                      <div>
                        <dt className="text-xs uppercase tracking-wider text-slate-500">Остались по другую сторону</dt>
                        <dd className="mt-1 text-sm text-slate-200">{selectedArchive.occupants}</dd>
                      </div>
                    </dl>
                    {(selectedArchive.lostOccupants ?? 0) > 0 && (
                      <div role="alert" className="mt-5 rounded-xl border border-rose-500/60 bg-rose-500/10 p-4">
                        <p className="font-semibold text-rose-200">Происшествие требует внимания</p>
                        <p className="mt-1 text-sm text-rose-100">Запись происшествия и число потерь сохранены в журнале событий портала.</p>
                      </div>
                    )}
                    <p className="mt-4 text-sm leading-6 text-slate-300">{selectedArchive.notes}</p>
                    <div className="mt-5 border-t border-slate-800 pt-4">
                      <h4 className="mb-3 font-semibold text-white">История портала</h4>
                      <EventList events={selectedArchive.eventLog} />
                    </div>
                  </article>
                )}
              </div>
            )}
          </section>
        )}

        {screen === 'journal' && (
          <section className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
            <h2 className="text-xl font-semibold text-white">Журнал событий лаборатории</h2>
            <p className="mt-1 text-sm text-slate-400">События всех порталов, последние — первыми.</p>
            <div className="mt-5">
              {allEvents.length > 0 ? (
                <div className="space-y-3">
                  {allEvents.map((event) => (
                    <article key={`${event.portalId}:${event.id}`} className={`rounded-xl border bg-slate-950/60 p-4 ${event.result === 'critical' ? 'border-rose-500/60' : 'border-slate-800'}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className={`font-semibold ${event.result === 'critical' ? 'text-rose-200' : 'text-cyan-200'}`}>{actionLabels[event.action]} · {event.portalName}</p>
                        <time className="text-xs text-slate-500">{formatTimestamp(event.timestamp)}</time>
                      </div>
                      <p className="mt-2 text-sm text-slate-300">{event.description}</p>
                      <p className={`mt-2 text-xs ${event.result === 'blocked' || event.result === 'critical' ? 'text-rose-300' : event.result === 'warning' ? 'text-amber-300' : 'text-slate-400'}`}>
                        {eventResultLabels[event.result]}
                      </p>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="rounded-xl border border-slate-800 bg-slate-950/60 p-5 text-sm text-slate-300">
                  Событий пока нет. Новые операции будут записаны сюда.
                </p>
              )}
            </div>
          </section>
        )}

        {screen === 'worklog' && <Worklog />}
      </div>

      {showCreateForm && (
        <div className="fixed inset-0 z-10 flex items-center justify-center overflow-y-auto bg-slate-950/90 p-4">
          <form
            aria-label="Новый портал"
            onSubmit={handleCreatePortal}
            className="my-auto w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900 p-6"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-white">Новый портал</h2>
                <p className="mt-1 text-sm text-slate-400">Запись попадёт в журнал наблюдений.</p>
              </div>
              <button type="button" onClick={() => setShowCreateForm(false)} className="text-sm text-slate-300 hover:text-white">
                Отмена
              </button>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="text-sm text-slate-300">Название
                <input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white" />
                {draft.name.trim() && duplicatePortalName && (
                  <span role="alert" className="mt-1 block text-xs text-rose-300">
                    Портал с таким названием уже существует.
                  </span>
                )}
              </label>
              <label className="text-sm text-slate-300">Мир назначения
                <input required value={draft.destination} onChange={(event) => setDraft({ ...draft, destination: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white" />
              </label>
              <label className="text-sm text-slate-300">Энергия (%)
                <input type="number" min="0" max="100" required value={draft.energyLevel} onChange={(event) => setDraft({ ...draft, energyLevel: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white" />
              </label>
              <label className="text-sm text-slate-300">Стабильность (%)
                <input type="number" min="0" max="100" required value={draft.stability} onChange={(event) => setDraft({ ...draft, stability: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white" />
              </label>
              <label className="text-sm text-slate-300">Людей/существ внутри
                <input type="number" min="0" step="1" required value={draft.occupants} onChange={(event) => setDraft({ ...draft, occupants: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white" />
              </label>
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-400">
              Время до схлопывания рассчитывается автоматически из запаса энергии и стабильности. При текущих значениях прогноз: {formatDuration(
                (draft.energyLevel /
                  (DEFAULT_ENERGY_DRAIN_PER_MINUTE *
                    getEnergyDrainMultiplier(draft.stability))) *
                  60,
              )}; при стабильности 100% базовый расход — {DEFAULT_ENERGY_DRAIN_PER_MINUTE.toFixed(2)} процентного пункта в минуту.
            </p>
            <button type="submit" disabled={isReadOnly || duplicatePortalName} className="mt-5 rounded-xl bg-cyan-500 px-4 py-2 font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50">
              Создать запись
            </button>
          </form>
        </div>
      )}
      {resetConfirmation && (
        <div
          className="fixed inset-0 z-20 flex items-center justify-center bg-slate-950/85 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setResetConfirmation(false);
            }
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="demo-reset-title"
            className="w-full max-w-lg rounded-2xl border border-amber-500/40 bg-slate-900 p-6"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">
              Сброс демонстрации
            </p>
            <h2 id="demo-reset-title" className="mt-2 text-xl font-semibold text-white">
              Восстановить исходный набор порталов?
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Текущие локальные изменения, созданные порталы, архив и журнал будут заменены исходным демонстрационным набором. Таймеры начнут отсчёт заново.
            </p>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setResetConfirmation(false)}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={restoreDemoData}
                className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-300"
              >
                Подтвердить сброс
              </button>
            </div>
          </section>
        </div>
      )}
      {closeConfirmation && (
        <div
          className="fixed inset-0 z-20 flex items-center justify-center bg-slate-950/85 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setCloseConfirmation(null);
              setNotice('Закрытие отменено; портал не изменён.');
            }
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="close-confirmation-title"
            className="w-full max-w-lg rounded-2xl border border-amber-500/40 bg-slate-900 p-6"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">
              Подтверждение закрытия
            </p>
            <h2 id="close-confirmation-title" className="mt-2 text-xl font-semibold text-white">
              Закрыть «{closeConfirmation.name}»?
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Внутри остаются {closeConfirmation.occupants} человек/существ. Закрытие займёт одну минуту. Подтвердите только если последствия для них учтены.
            </p>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setCloseConfirmation(null);
                  setNotice('Закрытие отменено; портал не изменён.');
                }}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800"
              >
                Не закрывать
              </button>
              <button
                type="button"
                onClick={() => {
                  const portal = portals.find((item) => item.id === closeConfirmation.portalId);
                  setCloseConfirmation(null);
                  if (portal) {
                    updatePortal(portal, 'close', undefined, true);
                  } else {
                    setNotice('Не удалось найти портал для закрытия.');
                  }
                }}
                className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-300"
              >
                Подтвердить закрытие
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function EventList({ events }: { events: PortalEvent[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-slate-400">История этого портала пока пуста.</p>;
  }
  return (
    <div className="space-y-3">
      {events.map((event) => (
        <article key={event.id} className={`rounded-xl border bg-slate-900/70 p-3 ${event.result === 'critical' ? 'border-rose-500/60' : 'border-slate-800'}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className={`font-semibold ${event.result === 'critical' ? 'text-rose-300' : 'text-cyan-300'}`}>{actionLabels[event.action]}</span>
              <span className="text-slate-500">·</span>
              <span className={event.result === 'critical' ? 'font-semibold text-rose-300' : 'text-slate-300'}>{eventResultLabels[event.result]}</span>
            </div>
            <time className="text-xs text-slate-500">{formatTimestamp(event.timestamp)}</time>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-300">{event.description}</p>
        </article>
      ))}
    </div>
  );
}

function Worklog() {
  return (
    <section className="space-y-5 rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">Прозрачность разработки</p>
        <h2 className="mt-2 text-2xl font-semibold text-white">AI Worklog</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
          Краткая история разработки: требования, архитектурные решения, проверка логики и исправление ошибок.
        </p>
      </div>
      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <dt className="text-xs uppercase tracking-wider text-slate-500">AI-инструмент</dt>
          <dd className="mt-2 text-sm text-slate-200">GitHub Copilot в VS Code, режим Agent</dd>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <dt className="text-xs uppercase tracking-wider text-slate-500">Время разработки</dt>
          <dd className="mt-2 text-sm text-slate-200">Около 6 часов.</dd>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <dt className="text-xs uppercase tracking-wider text-slate-500">Токены</dt>
          <dd className="mt-2 text-sm text-slate-200">Количество токенов не измерялось доступными средствами.</dd>
        </div>
      </dl>
      <div>
        <h3 className="font-semibold text-white">Этапы разработки</h3>
        <ol className="mt-3 space-y-3">
          <li className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
            <h4 className="font-medium text-white">1. Формирование модели порталов</h4>
            <dl className="mt-3 space-y-2 text-sm leading-6">
              <div><dt className="font-semibold text-slate-200">Вклад человека</dt><dd className="text-slate-300">Определены смысл энергии как оставшегося запаса и роль стабильности в скорости расхода; уточнены ожидания к риску, времени до схлопывания и последствиям закрытия.</dd></div>
              <div><dt className="font-semibold text-slate-200">Вклад AI</dt><dd className="text-slate-300">Сформирована доменная модель портала и расчёты риска, допуска и ETA на основе состояния портала.</dd></div>
              <div><dt className="font-semibold text-slate-200">Ключевой промпт — реконструированный пример, не дословная цитата</dt><dd className="text-slate-400">«Раздели энергию и стабильность: энергия — оставшийся запас, стабильность влияет на скорость расхода; рассчитывай риск и срок схлопывания из текущего состояния».</dd></div>
            </dl>
          </li>
          <li className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
            <h4 className="font-medium text-white">2. Разработка бизнес-логики</h4>
            <dl className="mt-3 space-y-2 text-sm leading-6">
              <div><dt className="font-semibold text-slate-200">Вклад человека</dt><dd className="text-slate-300">Выбраны длительности операций: стабилизация — 2 минуты, наблюдатель — 5 минут, штатное закрытие — 1 минута. Уточнены условия прохода, аварийного схлопывания и учёта находящихся внутри.</dd></div>
              <div><dt className="font-semibold text-slate-200">Вклад AI</dt><dd className="text-slate-300">Реализованы проверки доменных действий, временные состояния операций, отмена, фиксация входов/выходов и обработка критических порогов.</dd></div>
              <div><dt className="font-semibold text-slate-200">Ключевой промпт — реконструированный пример, не дословная цитата</dt><dd className="text-slate-400">«Сделай стабилизацию и визит наблюдателя временными операциями; учитывай наблюдателя внутри и запрещай действия, нарушающие пороги безопасности».</dd></div>
            </dl>
          </li>
          <li className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
            <h4 className="font-medium text-white">3. Интерфейс и состояние системы</h4>
            <dl className="mt-3 space-y-2 text-sm leading-6">
              <div><dt className="font-semibold text-slate-200">Вклад человека</dt><dd className="text-slate-300">Уточнены состав карточек и сводки, отдельное представление закрытых порталов, поведение очереди внимания и необходимость сброса демонстрационных данных.</dd></div>
              <div><dt className="font-semibold text-slate-200">Вклад AI</dt><dd className="text-slate-300">Созданы обзор, карточки, сводка, очереди, журнал, архив и сохранение состояния браузера; связаны просмотр происшествия, архив и журнал.</dd></div>
              <div><dt className="font-semibold text-slate-200">Ключевой промпт — реконструированный пример, не дословная цитата</dt><dd className="text-slate-400">«Раздели активные порталы и архив, сохрани критические происшествия в журнале и сделай очередь внимания понятной и полной».</dd></div>
            </dl>
          </li>
          <li className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
            <h4 className="font-medium text-white">4. Проверка сценариев и исправление ошибок</h4>
            <dl className="mt-3 space-y-2 text-sm leading-6">
              <div><dt className="font-semibold text-slate-200">Вклад человека</dt><dd className="text-slate-300">Проверялись логика и интерфейс; выявленные несоответствия формулировались как требования к исправлению, в том числе по шкале 180 минут, очереди внимания и заметности отказов.</dd></div>
              <div><dt className="font-semibold text-slate-200">Вклад AI</dt><dd className="text-slate-300">Исправлены подтверждённые расхождения, добавлены регрессионные тесты для расчётов, операций, схлопывания, хранения и отображения.</dd></div>
              <div><dt className="font-semibold text-slate-200">Ключевой промпт — реконструированный пример, не дословная цитата</dt><dd className="text-slate-400">«Проверь согласованность состояния портала, журнала, архива и сводки; исправь найденное расхождение и закрепи сценарий автоматическим тестом».</dd></div>
            </dl>
          </li>
          <li className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
            <h4 className="font-medium text-white">5. Документация и публикация</h4>
            <dl className="mt-3 space-y-2 text-sm leading-6">
              <div><dt className="font-semibold text-slate-200">Вклад человека</dt><dd className="text-slate-300">Выбраны русский язык документации, публикация на GitHub Pages, локальная инструкция, краткое знакомство с приложением и повторяемая демонстрация.</dd></div>
              <div><dt className="font-semibold text-slate-200">Вклад AI</dt><dd className="text-slate-300">Подготовлены README и Worklog, настройка публикации Vite/GitHub Pages и цикл повторного открытия стартовых демо-порталов.</dd></div>
              <div><dt className="font-semibold text-slate-200">Ключевой промпт — реконструированный пример, не дословная цитата</dt><dd className="text-slate-400">«Подготовь русскоязычную документацию с опубликованной и локальной инструкциями и сделай стартовый набор порталов пригодным для повторной демонстрации».</dd></div>
            </dl>
          </li>
        </ol>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <h3 className="font-semibold text-white">Ключевые решения, заданные в требованиях</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-300">
            <li>Энергия — оставшийся запас, стабильность влияет на скорость расхода; риск растёт при истощении. Полный запас и 100% стабильности соответствуют 180 минутам.</li>
            <li>Операции имеют заданную длительность: стабилизация — 2 минуты, визит наблюдателя — 5 минут, штатное закрытие — 1 минута.</li>
            <li>Нулевая энергия или стабильность приводят к немедленному схлопыванию. Потери фиксируются в происшествии, а число оставшихся сохраняется без двойного учёта.</li>
            <li>Закрытые порталы отделены в архиве; после просмотра происшествия стартовая запись может замениться новой итерацией, события остаются в журнале.</li>
            <li>Ограничения проверяются в бизнес-логике; недопустимые действия объясняются в интерфейсе и записываются в журнал.</li>
          </ul>
        </div>
        <div>
          <h3 className="font-semibold text-white">Ошибки AI и корректировки</h3>
          <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-300">
            <li>Первоначальная формула риска увеличивала риск вместе с остатком энергии; энергетический вклад исправлен на рост риска при истощении запаса.</li>
            <li>Ранний ETA не следовал из запаса, а стабилизация произвольно добавляла время. Расчёт привязан к расходу энергии и стабильности.</li>
            <li>При 100% энергии и стабильности прогноз составлял 100 вместо 180 минут. Базовый расход, демо-порталы и миграция стартовых сохранений приведены к 180-минутной шкале.</li>
            <li>Отказ от операции был заметен главным образом в журнале; добавлено контрастное уведомление с причиной.</li>
            <li>В очереди не отображалась отметка «под вопросом» рядом с рекомендацией «Допуск требует проверки»; добавлена короткая отдельная отметка.</li>
            <li>Закрытые порталы исключены из текущего риска и ETA; повторная обработка схлопывания не должна создавать новые потери, а замена демо-итерации сохраняет события в журнале.</li>
          </ul>
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <h3 className="font-semibold text-white">Результаты проверок</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-300">
            <li><strong>Автоматические тесты:</strong> 70 тестов Vitest в 2 файлах — пройдены.</li>
            <li><strong>Сборка:</strong> TypeScript/Vite — пройдена.</li>
            <li><strong>Lint:</strong> Oxlint — пройден.</li>
            <li><strong>Проверка diff:</strong> <code>git diff --check</code> — пройдена.</li>
            <li><strong>Ручная браузерная проверка:</strong> проверялись опубликованная GitHub Pages и локальный запуск: загрузка и навигация; создание порталов и отказ для занятого имени; стабилизация, прогноз и отказ при недостатке энергии; пятиминутный визит наблюдателя и отказ при недостаточном окне; отметка «под вопросом»; фиксация входов/выходов; просмотр происшествия и исчезновение его плашки из очереди при сохранении события в журнале; схлопывания при нулевой энергии и стабильности 0% после прохода; предупреждение при закрытии с находящимися внутри; сброс демо-данных.</li>
          </ul>
        </div>
      </div>
      <div>
        <h3 className="font-semibold text-white">Процесс разработки</h3>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Требования, правила предметной области и приоритеты определялись в ходе разработки. GitHub Copilot Agent использовался для реализации кода, тестов и документации; результат проверялся на соответствие правилам и сценариям. Ручного редактирования кода не производилось.
        </p>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <h3 className="font-semibold text-white">Ограничения текущего продукта</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-300">
            <li>Данные хранятся в localStorage; серверного хранения и многопользовательской синхронизации нет.</li>
            <li>Нет полноценного обнаружения и обработки потери связи с наблюдателем.</li>
            <li>Нет серверного аудита, восстановления после сбоев и внешних аварийных уведомлений.</li>
            <li>Пороги риска заданы в коде, а не настраиваются из интерфейса.</li>
            <li>Для применения вне демонстрационного сценария необходимы дополнительные интеграционные тесты и калибровка модели.</li>
          </ul>
        </div>
        <div>
          <h3 className="font-semibold text-white">Что улучшить для реального продукта</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-300">
            <li>Добавить задание наблюдателю с целями осмотра и контрольным списком, структурированный отчёт после возвращения и действия смотрителя при просрочке или потере связи.</li>
            <li>Реализовать защищённую связь и отчёты находящихся внутри; учитывать их показания, наблюдателя и качество связи в оценке риска.</li>
            <li>Перейти к серверной базе, авторизации и ролям, совместной работе смотрителей, аудиту, резервным копиям и восстановлению.</li>
            <li>Добавить внешние аварийные уведомления, мониторинг доступности и калибровку модели на подтверждённых данных.</li>
          </ul>
        </div>
      </div>
    </section>
  );
}

export default App;
