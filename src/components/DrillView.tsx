import { useMemo } from 'react';
import type { VerifiedPackage } from '../types';
import { visibleFaults, type DrillAction, type DrillState } from '../state/drillReducer';

interface DrillViewProps {
  activePackage: VerifiedPackage | null;
  drillState: DrillState;
  dispatch: (action: DrillAction) => void;
}

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'long'
  }).format(new Date(iso));
}

export function DrillView({ activePackage, drillState, dispatch }: DrillViewProps) {
  const version = activePackage?.manifest.version ?? null;
  const run = version ? drillState.runsByVersion[version] : undefined;
  const visible = useMemo(() => (run ? visibleFaults(run) : []), [run]);

  if (!activePackage || !run) {
    return (
      <div className="card empty-state">
        <strong>请先安装并激活手册</strong>
        <p>离线演练必须绑定一个完整校验通过的当前版本。</p>
      </div>
    );
  }

  const setQuery = (query: string) => {
    if (version) dispatch({ type: 'SEARCH', version, query });
  };

  const canAcknowledge = (indexInFullList: number): boolean => {
    return run.items.slice(0, indexInFullList).every((item) => item.acknowledged);
  };

  return (
    <section className="card" aria-label="离线演练">
      <h2>离线故障演练</h2>
      <p className="muted">
        当前绑定版本：<strong>{activePackage.manifest.version}</strong>。搜索当前版故障条目，按顺序逐项确认。
      </p>
      <input
        className="search"
        type="search"
        placeholder="搜索故障、症状、诊断或处置，例如：总线、指示灯、断路器"
        value={run.query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label="搜索当前版故障条目"
      />

      {run.status === 'passed' && run.passedAt && (
        <div className="pass-certificate" role="status">
          <div className="mark">✓</div>
          <h3>离线演练通过</h3>
          <p>本结论只绑定手册版本 <strong>{activePackage.manifest.version}</strong>，不能用于其他版本。</p>
          <p className="muted">通过时间：{formatTime(run.passedAt)}</p>
        </div>
      )}

      <div className="drill-list">
        {visible.map((item) => {
          const fullIndex = run.items.findIndex((candidate) => candidate.fault.id === item.fault.id);
          const locked = !item.acknowledged && !canAcknowledge(fullIndex);
          return (
            <label key={item.fault.id} className={`drill-item ${item.acknowledged ? 'done' : ''} ${locked ? 'locked' : ''}`}>
              <input
                type="checkbox"
                checked={item.acknowledged}
                disabled={run.status === 'passed' || (!item.acknowledged && locked)}
                onChange={(event) => {
                  if (!version) return;
                  dispatch({
                    type: event.target.checked ? 'ACKNOWLEDGE' : 'UNACKNOWLEDGE',
                    version,
                    faultId: item.fault.id
                  });
                }}
              />
              <span>
                <h4>{item.fault.title}</h4>
                <p><strong>症状：</strong>{item.fault.symptom}</p>
                <p><strong>诊断：</strong>{item.fault.diagnosis}</p>
                <p><strong>处置：</strong>{item.fault.action}</p>
                {locked && <p className="warning">必须先按顺序确认上一条。</p>}
                {item.acknowledged && <p className="success">已按当前版手册完成确认。</p>}
              </span>
            </label>
          );
        })}
        {visible.length === 0 && <p className="muted">当前版没有匹配的故障条目。</p>}
      </div>
    </section>
  );
}
