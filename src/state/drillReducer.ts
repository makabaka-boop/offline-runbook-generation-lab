import type { DrillItem, DrillRun, DrillState, FaultEntry } from '../types';

export type { DrillState };

export type DrillAction =
  | { type: 'SEARCH'; version: string; query: string }
  | { type: 'ACKNOWLEDGE'; version: string; faultId: string }
  | { type: 'UNACKNOWLEDGE'; version: string; faultId: string }
  | { type: 'VERSION_SWITCHED'; version: string; faults: readonly FaultEntry[] };

export function createRun(faults: readonly FaultEntry[], query = ''): DrillRun {
  return {
    status: 'searching',
    query,
    items: faults.map((fault) => ({ fault, acknowledged: false })),
    passedAt: null
  };
}

export const initialDrillState: DrillState = { runsByVersion: {} };

function updateRun(state: DrillState, version: string, update: (run: DrillRun) => DrillRun): DrillState {
  const run = state.runsByVersion[version];
  if (!run) return state;
  return { ...state, runsByVersion: { ...state.runsByVersion, [version]: update(run) } };
}

function resetUnfinished(faults: readonly FaultEntry[], run: DrillRun): DrillRun {
  return run.status === 'passed' ? run : createRun(faults, run.query);
}

export function drillReducer(state: DrillState, action: DrillAction): DrillState {
  switch (action.type) {
    case 'VERSION_SWITCHED': {
      const resetOtherVersions: Record<string, DrillRun> = {};
      for (const [runVersion, run] of Object.entries(state.runsByVersion)) {
        resetOtherVersions[runVersion] =
          run.status === 'passed'
            ? run
            : {
                ...run,
                status: 'searching',
                query: '',
                passedAt: null,
                items: run.items.map((item) => ({ ...item, acknowledged: false }))
              };
      }
      const existing = state.runsByVersion[action.version];
      return {
        runsByVersion: {
          ...resetOtherVersions,
          [action.version]: existing
            ? resetUnfinished(action.faults, existing)
            : createRun(action.faults)
        }
      };
    }
    case 'SEARCH':
      return updateRun(state, action.version, (run) =>
        run.status === 'passed'
          ? run
          : {
              ...run,
              query: action.query,
              status: action.query.trim().length > 0 ? 'checking' : 'searching'
            }
      );
    case 'ACKNOWLEDGE':
      return updateRun(state, action.version, (run) => {
        if (run.status === 'passed') return run;
        const index = run.items.findIndex((item) => item.fault.id === action.faultId);
        if (index < 0) return run;
        const priorComplete = run.items.slice(0, index).every((item) => item.acknowledged);
        if (!priorComplete) return run;
        const items = run.items.map((item, itemIndex) =>
          itemIndex === index ? { ...item, acknowledged: true } : item
        );
        const passed = items.every((item) => item.acknowledged);
        return {
          ...run,
          status: passed ? 'passed' : 'checking',
          items,
          passedAt: passed ? new Date().toISOString() : null
        };
      });
    case 'UNACKNOWLEDGE':
      return updateRun(state, action.version, (run) => {
        if (run.status === 'passed') return run;
        const index = run.items.findIndex((item) => item.fault.id === action.faultId);
        if (index < 0) return run;
        const laterIncomplete = run.items.slice(index + 1).some((item) => !item.acknowledged);
        if (laterIncomplete) return run;
        const items = run.items.map((item, itemIndex) =>
          itemIndex === index ? { ...item, acknowledged: false } : item
        );
        return { ...run, status: run.query.trim() ? 'checking' : 'searching', items };
      });
    default:
      return state;
  }
}

export function visibleFaults(run: DrillRun): readonly DrillItem[] {
  const query = run.query.trim().toLocaleLowerCase('zh-CN');
  if (!query) return run.items;
  return run.items.filter(({ fault }) =>
    [fault.id, fault.title, fault.symptom, fault.diagnosis, fault.action]
      .join('\n')
      .toLocaleLowerCase('zh-CN')
      .includes(query)
  );
}
