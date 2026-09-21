import type { FailureReason, InstallState, PersistentState } from '../types';

export type ManualAction =
  | { type: 'BOOTSTRAP_COMPLETE'; state: PersistentState; activeVersion: string | null }
  | { type: 'INSTALL_STARTED'; version: string; total: number }
  | { type: 'INSTALL_PROGRESS'; version: string; progress: number; total: number }
  | { type: 'INSTALL_READY'; version: string }
  | { type: 'INSTALL_FAILED'; version: string; reason: FailureReason; message: string }
  | { type: 'ACTIVATING'; version: string }
  | { type: 'ACTIVATED'; version: string }
  | { type: 'READY_DISCARDED'; version: string }
  | { type: 'FAILURE_DISMISSED' };

export interface ManualUiState {
  readonly bootstrapped: boolean;
  readonly activeVersion: string | null;
  readonly persisted: PersistentState;
  readonly lastError: { reason: FailureReason; message: string; version: string } | null;
}

export const idleInstall: InstallState = {
  phase: 'idle',
  version: null,
  progress: 0,
  total: 0,
  failureReason: null,
  failureMessage: null
};

export const initialManualState: ManualUiState = {
  bootstrapped: false,
  activeVersion: null,
  persisted: {
    currentVersion: null,
    install: idleInstall
  },
  lastError: null
};

function withInstall(persisted: PersistentState, install: InstallState): PersistentState {
  return { ...persisted, install };
}

function sameInstall(install: InstallState, version: string): boolean {
  return install.version === version && (install.phase === 'installing' || install.phase === 'activating');
}

export function manualReducer(state: ManualUiState, action: ManualAction): ManualUiState {
  switch (action.type) {
    case 'BOOTSTRAP_COMPLETE':
      return {
        ...state,
        bootstrapped: true,
        activeVersion: action.activeVersion,
        persisted: action.state,
        lastError: null
      };
    case 'INSTALL_STARTED':
      return {
        ...state,
        lastError: null,
        persisted: withInstall(state.persisted, {
          phase: 'installing',
          version: action.version,
          progress: 0,
          total: action.total,
          failureReason: null,
          failureMessage: null
        })
      };
    case 'INSTALL_PROGRESS':
      if (!sameInstall(state.persisted.install, action.version)) return state;
      return {
        ...state,
        persisted: withInstall(state.persisted, {
          ...state.persisted.install,
          progress: action.progress,
          total: action.total
        })
      };
    case 'INSTALL_READY':
      if (state.persisted.install.version !== action.version || state.persisted.install.phase !== 'installing') {
        return state;
      }
      return {
        ...state,
        lastError: null,
        persisted: withInstall(state.persisted, {
          ...state.persisted.install,
          phase: 'ready',
          progress: state.persisted.install.total,
          failureReason: null,
          failureMessage: null
        })
      };
    case 'INSTALL_FAILED': {
      if (state.persisted.install.version !== action.version) return state;
      const failed: InstallState = {
        phase: 'failed',
        version: action.version,
        progress: 0,
        total: 0,
        failureReason: action.reason,
        failureMessage: action.message
      };
      return {
        ...state,
        persisted: withInstall(state.persisted, failed),
        lastError: { reason: action.reason, message: action.message, version: action.version }
      };
    }
    case 'ACTIVATING':
      if (state.persisted.install.version !== action.version || state.persisted.install.phase !== 'ready') {
        return state;
      }
      return {
        ...state,
        persisted: withInstall(state.persisted, { ...state.persisted.install, phase: 'activating' })
      };
    case 'ACTIVATED':
      if (state.persisted.install.version !== action.version || state.persisted.install.phase !== 'activating') {
        return state;
      }
      return {
        ...state,
        activeVersion: action.version,
        lastError: null,
        persisted: { currentVersion: action.version, install: idleInstall }
      };
    case 'READY_DISCARDED':
      if (state.persisted.install.version !== action.version || state.persisted.install.phase !== 'ready') {
        return state;
      }
      return { ...state, persisted: { ...state.persisted, install: idleInstall } };
    case 'FAILURE_DISMISSED':
      return { ...state, lastError: null };
    default:
      return state;
  }
}
