import { useMemo, useState } from 'react';

import { DEMO_PORTALS } from './data/demo-portals';
import { applyPortalAction, evaluatePortal, summarizePortals } from './lib/portal-rules';
import { loadPortals, savePortals } from './lib/storage';
import type { Portal, PortalAction } from './types';

const actionLabels: Record<PortalAction, string> = {
  stabilize: 'Stabilize',
  close: 'Close',
  send_observer: 'Send observer',
  mark_under_review: 'Mark under review',
};

const riskStyles: Record<string, string> = {
  low: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-500/40',
  moderate: 'bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-500/40',
  high: 'bg-orange-500/15 text-orange-300 ring-1 ring-inset ring-orange-500/40',
  critical: 'bg-rose-500/15 text-rose-300 ring-1 ring-inset ring-rose-500/40',
};

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function App() {
  const [portals, setPortals] = useState<Portal[]>(() => loadPortals(DEMO_PORTALS));
  const [selectedId, setSelectedId] = useState<string>(() => loadPortals(DEMO_PORTALS)[0]?.id ?? '');
  const [notice, setNotice] = useState<string | null>(null);

  const storageWarning = savePortals(portals)
    ? null
    : 'Storage write failed. The latest portal states are not being persisted.';

  const selectedPortal = portals.find((portal) => portal.id === selectedId) ?? portals[0] ?? null;
  const summary = useMemo(() => summarizePortals(portals), [portals]);

  const handleAction = (action: PortalAction, portal: Portal) => {
    try {
      const confirmClose = action === 'close' && portal.occupants > 0;
      if (confirmClose && !window.confirm('Portal still contains creatures or personnel. Confirm closure anyway?')) {
        return;
      }

      const nextPortal = applyPortalAction(portal, action, {
        confirmClose,
      });

      setPortals((current) => current.map((item) => (item.id === portal.id ? nextPortal : item)));
      setSelectedId(nextPortal.id);
      setNotice(`${actionLabels[action]} completed for ${portal.name}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'An unknown error occurred.';
      setNotice(message);
    }
  };

  if (!selectedPortal && portals.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-slate-200">
        <div className="max-w-xl rounded-2xl border border-slate-800 bg-slate-900/80 p-8 shadow-2xl shadow-slate-950/30">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-cyan-300">Portal monitor</p>
          <h1 className="mt-4 text-3xl font-semibold">No active portal records</h1>
          <p className="mt-3 text-slate-300">
            The archive is empty. Add an operational portal entry or reload the last saved dataset to resume monitoring.
          </p>
        </div>
      </div>
    );
  }

  const selectedEvaluation = selectedPortal ? evaluatePortal(selectedPortal) : null;

  const actionConfig = selectedPortal
    ? [
        { action: 'stabilize' as const, label: 'Stabilize', disabled: selectedPortal.currentStatus === 'closed' },
        { action: 'close' as const, label: 'Close', disabled: false },
        { action: 'send_observer' as const, label: 'Send observer', disabled: selectedPortal.currentStatus === 'closed' || (selectedEvaluation?.riskLevel ?? 'low') === 'critical' },
        { action: 'mark_under_review' as const, label: 'Mark under review', disabled: selectedPortal.currentStatus === 'closed' },
      ]
    : [];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8 rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl shadow-slate-950/30">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-cyan-300">Laboratory portal monitor</p>
              <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white">Portal security overview</h1>
            </div>
            <div className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-sm text-cyan-200">
              Last sync: {selectedPortal ? formatTimestamp(selectedPortal.lastUpdated) : '—'}
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[
              { label: 'Open portals', value: summary.openPortals, tone: 'text-cyan-300' },
              { label: 'Critical risk', value: summary.criticalRisk, tone: 'text-rose-300' },
              { label: 'Closed portals', value: summary.closedPortals, tone: 'text-violet-300' },
              { label: 'Require attention', value: summary.attentionPortals, tone: 'text-amber-300' },
            ].map((item) => (
              <div key={item.label} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{item.label}</p>
                <p className={`mt-3 text-3xl font-bold ${item.tone}`}>{item.value}</p>
              </div>
            ))}
          </div>

          {storageWarning ? (
            <div className="mt-6 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              {storageWarning}
            </div>
          ) : null}

          {notice ? (
            <div className="mt-6 rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
              {notice}
            </div>
          ) : null}
        </header>

        <main className="grid gap-6 xl:grid-cols-[1.2fr_2fr]">
          <aside className="rounded-3xl border border-slate-800 bg-slate-900/80 p-4 shadow-lg shadow-slate-950/20">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-white">Portal list</h2>
              <span className="rounded-full border border-slate-700 bg-slate-800 px-2 py-1 text-xs uppercase tracking-[0.18em] text-slate-300">
                {portals.length} total
              </span>
            </div>

            <div className="space-y-3">
              {portals.map((portal) => {
                const evaluation = evaluatePortal(portal);

                return (
                  <button
                    key={portal.id}
                    type="button"
                    onClick={() => setSelectedId(portal.id)}
                    className={`w-full rounded-2xl border p-4 text-left transition hover:border-cyan-500/60 hover:bg-slate-800/80 ${selectedPortal?.id === portal.id ? 'border-cyan-500/70 bg-slate-800/90' : 'border-slate-800 bg-slate-950/50'}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-lg font-semibold text-white">{portal.name}</p>
                        <p className="text-sm text-slate-400">{portal.destination}</p>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${riskStyles[evaluation.riskLevel]}`}>
                        {evaluation.riskLevel}
                      </span>
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-3 text-sm text-slate-300">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Risk</p>
                        <p className="mt-1 font-semibold text-white">{evaluation.riskScore}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Stability</p>
                        <p className="mt-1 font-semibold text-white">{portal.stability}%</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Window</p>
                        <p className="mt-1 font-semibold text-white">{portal.timeToCollapseMinutes}m</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          {selectedPortal && selectedEvaluation ? (
            <section className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5 shadow-lg shadow-slate-950/20">
              <div className="flex flex-col gap-4 border-b border-slate-800 pb-5 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Selected portal</p>
                  <h2 className="mt-2 text-3xl font-semibold text-white">{selectedPortal.name}</h2>
                  <p className="mt-2 text-slate-300">Destination: {selectedPortal.destination}</p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-sm text-slate-200">
                    {selectedPortal.currentStatus === 'open' ? 'Open' : selectedPortal.currentStatus === 'closed' ? 'Closed' : 'Under review'}
                  </span>
                  <span className={`rounded-full px-3 py-1 text-sm font-medium ${riskStyles[selectedEvaluation.riskLevel]}`}>
                    {selectedEvaluation.riskLevel.toUpperCase()} risk
                  </span>
                </div>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Energy</p>
                  <p className="mt-2 text-2xl font-bold text-white">{selectedPortal.energyLevel}%</p>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Stability</p>
                  <p className="mt-2 text-2xl font-bold text-white">{selectedPortal.stability}%</p>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Collapse</p>
                  <p className="mt-2 text-2xl font-bold text-white">{selectedPortal.timeToCollapseMinutes} min</p>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Occupants</p>
                  <p className="mt-2 text-2xl font-bold text-white">{selectedPortal.occupants}</p>
                </div>
              </div>

              <div className="mt-6 grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
                <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Pass status</p>
                  <div className="mt-3 flex items-center gap-3">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${selectedEvaluation.accessDecision === 'allowed' ? 'bg-emerald-500/15 text-emerald-300' : selectedEvaluation.accessDecision === 'requires_check' ? 'bg-amber-500/15 text-amber-300' : 'bg-rose-500/15 text-rose-300'}`}>
                      {selectedEvaluation.accessDecision}
                    </span>
                    <span className="text-sm text-slate-300">
                      {selectedEvaluation.accessDecision === 'allowed'
                        ? 'Pass permitted.'
                        : selectedEvaluation.accessDecision === 'requires_check'
                          ? 'Requires manual verification before transit.'
                          : 'Transit forbidden under current conditions.'}
                    </span>
                  </div>
                  <p className="mt-4 text-sm leading-6 text-slate-300">{selectedPortal.notes}</p>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Controls</p>
                  <div className="mt-3 space-y-2">
                    {actionConfig.map(({ action, label, disabled }) => (
                      <button
                        key={action}
                        type="button"
                        onClick={() => handleAction(action, selectedPortal)}
                        disabled={disabled}
                        className="flex w-full items-center justify-between rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-left text-sm font-medium text-slate-100 transition hover:border-cyan-500/60 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <span>{label}</span>
                        <span className="text-slate-400">→</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h3 className="text-lg font-semibold text-white">Event journal</h3>
                  <span className="text-xs uppercase tracking-[0.18em] text-slate-500">{selectedPortal.eventLog.length} logs</span>
                </div>

                {selectedPortal.eventLog.length > 0 ? (
                  <div className="space-y-3">
                    {selectedPortal.eventLog.map((event) => (
                      <div key={event.id} className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                          <div className="flex items-center gap-2 text-sm">
                            <span className="font-semibold text-cyan-300">{actionLabels[event.action]}</span>
                            <span className="text-slate-500">·</span>
                            <span className="text-slate-300">{event.result}</span>
                          </div>
                          <time className="text-xs text-slate-500">{formatTimestamp(event.timestamp)}</time>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-slate-300">{event.description}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">No event history recorded for this portal.</p>
                )}
              </div>
            </section>
          ) : null}
        </main>
      </div>
    </div>
  );
}

export default App;
