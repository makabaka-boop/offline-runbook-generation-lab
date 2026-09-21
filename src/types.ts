export type ResourceKind = 'manifest' | 'steps' | 'faults' | 'notes';

export interface ResourceRecord {
  readonly url: string;
  readonly kind: ResourceKind;
  readonly bytes: number;
  readonly sha256: string;
}

export interface FaultEntry {
  readonly id: string;
  readonly title: string;
  readonly symptom: string;
  readonly diagnosis: string;
  readonly action: string;
}

export interface SafetyNotes {
  readonly id: string;
  readonly title: string;
  readonly body: string;
}

export interface PackageManifest {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly version: string;
  readonly label: string;
  readonly issuedAt: string;
  readonly originUrl: string;
  readonly steps: readonly string[];
  readonly resources: readonly ResourceRecord[];
}

export interface CatalogEntry {
  readonly id: string;
  readonly version: string;
  readonly label: string;
  readonly issuedAt: string;
  readonly originUrl: string;
  readonly manifestSha256: string;
  readonly manifestBytes: number;
  readonly resources: readonly ResourceRecord[];
}

export interface VerifiedPackage {
  readonly manifest: PackageManifest;
  readonly steps: readonly string[];
  readonly faults: readonly FaultEntry[];
  readonly notes: SafetyNotes;
}

export type InstallPhase = 'idle' | 'installing' | 'ready' | 'activating' | 'failed';
export type FailureReason = 'network' | 'checksum' | 'quota' | 'canceled' | 'unknown';

export interface InstallState {
  readonly phase: InstallPhase;
  readonly version: string | null;
  readonly progress: number;
  readonly total: number;
  readonly failureReason: FailureReason | null;
  readonly failureMessage: string | null;
}

export interface PersistentState {
  readonly currentVersion: string | null;
  readonly install: InstallState;
}

export interface DrillItem {
  readonly fault: FaultEntry;
  readonly acknowledged: boolean;
}

export interface DrillRun {
  readonly status: 'searching' | 'checking' | 'passed';
  readonly query: string;
  readonly items: readonly DrillItem[];
  readonly passedAt: string | null;
}

export interface DrillState {
  readonly runsByVersion: Readonly<Record<string, DrillRun>>;
}
