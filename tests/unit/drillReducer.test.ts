import { describe, expect, it } from 'vitest';
import { createRun, drillReducer, initialDrillState, visibleFaults } from '../../src/state/drillReducer';
import type { FaultEntry } from '../../src/types';

const faultsV1: readonly FaultEntry[] = [
  { id: 'lamp', title: '指示灯不亮', symptom: '灯不亮', diagnosis: '检查保险', action: '暂停' },
  { id: 'breaker', title: '断路器卡住', symptom: '手柄不动', diagnosis: '检查机械锁', action: '隔离' }
];
const faultsV2: readonly FaultEntry[] = [
  faultsV1[0],
  faultsV1[1],
  { id: 'bus', title: '总线转移失败', symptom: '接收灯闪烁', diagnosis: '检查联锁', action: '取消转移' }
];

function withVersion(version: string, faults: readonly FaultEntry[]) {
  return drillReducer(initialDrillState, { type: 'VERSION_SWITCHED', version, faults });
}

describe('offline drill state coordination', () => {
  it('searches only current-version fault entries', () => {
    let state = withVersion('2024.11.0', faultsV1);
    state = drillReducer(state, { type: 'SEARCH', version: '2024.11.0', query: '断路器' });
    const run = state.runsByVersion['2024.11.0'];
    expect(visibleFaults(run).map((item) => item.fault.id)).toEqual(['breaker']);
  });

  it('requires ordered acknowledgement and binds pass result to version', () => {
    let state = withVersion('2025.03.2', faultsV2);
    const ignored = drillReducer(state, { type: 'ACKNOWLEDGE', version: '2025.03.2', faultId: 'breaker' });
    expect(ignored.runsByVersion['2025.03.2'].items[1].acknowledged).toBe(false);

    state = drillReducer(state, { type: 'ACKNOWLEDGE', version: '2025.03.2', faultId: 'lamp' });
    state = drillReducer(state, { type: 'ACKNOWLEDGE', version: '2025.03.2', faultId: 'breaker' });
    state = drillReducer(state, { type: 'ACKNOWLEDGE', version: '2025.03.2', faultId: 'bus' });
    const run = state.runsByVersion['2025.03.2'];
    expect(run.status).toBe('passed');
    expect(run.passedAt).not.toBeNull();
  });

  it('terminates unfinished drills when switching versions while retaining a completed binding', () => {
    let state = withVersion('2024.11.0', faultsV1);
    state = drillReducer(state, { type: 'ACKNOWLEDGE', version: '2024.11.0', faultId: 'lamp' });
    state = drillReducer(state, { type: 'SEARCH', version: '2024.11.0', query: '灯' });
    state = drillReducer(state, { type: 'VERSION_SWITCHED', version: '2025.03.2', faults: faultsV2 });
    expect(state.runsByVersion['2024.11.0'].status).toBe('searching');
    expect(state.runsByVersion['2024.11.0'].query).toBe('');
    expect(state.runsByVersion['2024.11.0'].items.every((item) => !item.acknowledged)).toBe(true);
    expect(state.runsByVersion['2025.03.2'].items).toHaveLength(3);
  });

  it('preserves a passed certificate for the old version but it remains version-bound', () => {
    const passedRun = { ...createRun(faultsV1), status: 'passed' as const, passedAt: '2026-01-01T00:00:00.000Z',
      items: faultsV1.map((fault) => ({ fault, acknowledged: true })) };
    let state: typeof initialDrillState = { runsByVersion: { '2024.11.0': passedRun } };
    state = drillReducer(state, { type: 'VERSION_SWITCHED', version: '2025.03.2', faults: faultsV2 });
    expect(state.runsByVersion['2024.11.0'].status).toBe('passed');
    expect(state.runsByVersion['2025.03.2'].status).toBe('searching');
  });
});
