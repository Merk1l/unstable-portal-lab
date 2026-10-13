# Portal Control System

A laboratory monitoring dashboard for magical portals. It helps operators estimate risk, control access, enforce action rules, and keep a reliable event history without mixing business logic with UI code.

## Product goals

The application focuses on the core responsibilities of a lab watcher:

- track portal stability and imminent collapse windows;
- assess hazard severity using a transparent risk model;
- decide whether passage is allowed, requires verification, or is forbidden;
- permit only valid operational actions;
- keep an event journal that explains how a portal reached its current state;
- persist the dashboard state between browser reloads.

This version intentionally does not introduce a server, database, or external API layer because the required behavior can be implemented cleanly with local state and persistent browser storage.

## Tech stack

- React
- TypeScript
- Vite
- Tailwind CSS
- Vitest
- localStorage

## Architecture

- `src/types.ts` — central domain types.
- `src/lib/portal-rules.ts` — risk model, access rules, action validation, summary calculations.
- `src/lib/storage.ts` — safe localStorage read/write wrappers.
- `src/data/demo-portals.ts` — demonstration data separated from operational storage state.
- `src/App.tsx` — dashboard UI and workflow binding.
- `src/lib/portal-rules.test.ts` — automated tests for critical business rules.

The business rules are intentionally separated from the React UI layer so they remain testable without a browser and easy to replace if storage or interface technology changes.

## Risk formula

The risk score is calculated in the `portal-rules` module and uses three factors:

- energy level (45% weight)
- instability (100 - stability, 35% weight)
- urgency until collapse (20% weight)

Formula:

`risk = clamp(round((energy * 0.45) + ((100 - stability) * 0.35) + ((1 - collapseWindow/180) * 100 * 0.20)), 0, 100)`

Where:

- `energy` is portal energy in percent;
- `stability` is the stability coefficient from 0 to 100;
- `collapseWindow` is the remaining time before collapse in minutes;
- the collapse window is normalized to an upper limit of 180 minutes for calibration.

Risk bands:

- low: 0-24
- moderate: 25-49
- high: 50-74
- critical: 75-100

This is not treated as a physical law; it is an operational risk model designed for lab decision support.

## Access policy

The "pass status" is independent from the general risk score.

A portal is:

- `allowed` when the risk is low, stability is acceptable, and the collapse window remains wide enough;
- `requires_check` when the risk is moderate or there is insufficient operational margin;
- `forbidden` when risk is critical, stability is too low, or the collapse window is too short.

Thresholds are centralized in `ACCESS_THRESHOLDS` and can be adjusted without editing the UI.

## Business rules

The following rules are enforced in business logic and not only through button disablement:

- A closed portal cannot be stabilized.
- A portal with critical risk cannot receive an observer.
- A portal cannot be closed while creatures or personnel remain inside unless the closure is explicitly confirmed.
- Closed portals cannot be moved to a review state.
- Under-review status means an additional verification is required; no technical characteristics are changed automatically.
- The dashboard summary always derives from the current portal list and never from stale data.

## Local development

1. Make sure Node.js and npm are available.
2. Install dependencies:

```bash
npm install
```

3. Start the application:

```bash
npm run dev -- --host 0.0.0.0
```

4. Open the local URL displayed by Vite, usually `http://localhost:5173`.

## Tests

```bash
npm test
```

The automated suite covers:

- risk calculation and risk thresholds;
- allow/requires-check/forbidden decisions;
- invalid action rejection;
- stabilization upgrades after intervention;
- closure confirmation logic for occupied portals;
- event log updates.

## Manual verification scenarios

1. Open the portal list and confirm the summary cards match the visible records.
2. Select a critical portal and verify the pass status changes to `forbidden` and the observer action is blocked.
3. Stabilize a portal with high energy and check whether risk decreases, stability increases, and the journal adds an event.
4. Attempt to close a portal with occupants without confirmation and verify the blocked action message appears.
5. Close a portal with explicit confirmation and verify the status becomes closed and the collapse time resets to zero.
6. Mark a portal as under review and confirm the status changes without modifying the underlying technical parameters.
7. Refresh the page and verify the saved state still loads from localStorage.
8. Simulate a storage write failure by temporarily disabling persistence in the browser and confirm the interface surfaces the warning.

## Publication guidance

The project is prepared to be published to Vercel or Netlify with the standard static site flow:

- build command: `npm run build`
- output folder: `dist`

For Vercel, import the repository and set the framework to Vite. For Netlify, set the build command and publish directory accordingly.

## Notes

- Demo data is intentionally separate from user-created records and clearly labeled as a demonstration dataset.
- The dashboard saves the current portal state in `localStorage` and safely falls back to the demo dataset if no saved data exists or if storage loading fails.
