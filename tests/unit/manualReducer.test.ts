import { describe, expect, it } from 'vitest';
import { initialManualState, manualReducer } from '../../src/state/manualReducer';
import type { PersistentState } from '../../src/types';

const persistedOld: PersistentState = {
  currentVersion: '2024.11.0',
  install: {
    phase: 'idle',
    version: null,
    progress: 0,
    total: 0,
    failureReason: null,
    failureMessage: null
  }
};

describe('manual installation state coordination', () => {
  it('first failed installation reports no usable offline package', () => {
    const started = manualReducer(initialManualState, {
      type: 'INSTALL_STARTED',
      version: '2024.11.0',
      total: 4
    });
    const failed = manualReducer(started, {
      type: 'INSTALL_FAILED',
      version: '2024.11.0',
      reason: 'network',
      message: '网络中断'
    });
    expect(failed.activeVersion).toBeNull();
    expect(failed.persisted.currentVersion).toBeNull();
    expect(failed.lastError?.reason).toBe('network');
  });

  it('keeps the old complete version while a half package downloads, fails, or is cancelled', () => {
    const booted = manualReducer(initialManualState, {
      type: 'BOOTSTRAP_COMPLETE',
      state: persistedOld,
      activeVersion: '2024.11.0'
    });
    const installing = manualReducer(booted, {
      type: 'INSTALL_STARTED',
      version: '2025.03.2',
      total: 4
    });
    expect(installing.activeVersion).toBe('2024.11.0');
    expect(installing.persisted.install.version).toBe('2025.03.2');

    const progressed = manualReducer(installing, {
      type: 'INSTALL_PROGRESS',
      version: '2025.03.2',
      progress: 2,
      total: 4
    });
    expect(progressed.persisted.install.progress).toBe(2);
    expect(progressed.activeVersion).toBe('2024.11.0');

    const checksumFailed = manualReducer(progressed, {
      type: 'INSTALL_FAILED',
      version: '2025.03.2',
      reason: 'checksum',
      message: '校验失败'
    });
    expect(checksumFailed.activeVersion).toBe('2024.11.0');
    expect(checksumFailed.persisted.currentVersion).toBe('2024.11.0');
    expect(checksumFailed.persisted.install.phase).toBe('failed');
  });

  it('does not let a ready package replace steps until activation commits', () => {
    const booted = manualReducer(initialManualState, {
      type: 'BOOTSTRAP_COMPLETE',
      state: persistedOld,
      activeVersion: '2024.11.0'
    });
    let state = manualReducer(booted, { type: 'INSTALL_STARTED', version: '2025.03.2', total: 4 });
    state = manualReducer(state, { type: 'INSTALL_READY', version: '2025.03.2' });
    expect(state.activeVersion).toBe('2024.11.0');
    expect(state.persisted.currentVersion).toBe('2024.11.0');
    expect(state.persisted.install.phase).toBe('ready');

    state = manualReducer(state, { type: 'ACTIVATING', version: '2025.03.2' });
    expect(state.activeVersion).toBe('2024.11.0');
    state = manualReducer(state, { type: 'ACTIVATED', version: '2025.03.2' });
    expect(state.activeVersion).toBe('2025.03.2');
    expect(state.persisted.currentVersion).toBe('2025.03.2');
    expect(state.persisted.install.phase).toBe('idle');
  });

  it('ignores progress from a stale installation generation', () => {
    let state = manualReducer(initialManualState, {
      type: 'BOOTSTRAP_COMPLETE',
      state: persistedOld,
      activeVersion: '2024.11.0'
    });
    state = manualReducer(state, { type: 'INSTALL_STARTED', version: '2025.03.2', total: 4 });
    const stale = manualReducer(state, {
      type: 'INSTALL_PROGRESS',
      version: '2024.11.0',
      progress: 99,
      total: 100
    });
    expect(stale).toBe(state);
  });

  it('discarding a verified but inactive package leaves the current generation untouched', () => {
    let state = manualReducer(initialManualState, {
      type: 'BOOTSTRAP_COMPLETE',
      state: { ...persistedOld, install: { phase: 'ready', version: '2025.03.2', progress: 4, total: 4, failureReason: null, failureMessage: null } },
      activeVersion: '2024.11.0'
    });
    state = manualReducer(state, { type: 'READY_DISCARDED', version: '2025.03.2' });
    expect(state.activeVersion).toBe('2024.11.0');
    expect(state.persisted.install.phase).toBe('idle');
  });
});
