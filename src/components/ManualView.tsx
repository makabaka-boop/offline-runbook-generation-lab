import type { CatalogEntry, VerifiedPackage } from '../types';
import type { ManualUiState } from '../state/manualReducer';

interface ManualViewProps {
  catalog: readonly CatalogEntry[];
  activePackage: VerifiedPackage | null;
  state: ManualUiState;
  online: boolean;
  onInstall: (version: string) => void;
  onCancel: () => void;
  onActivate: (version: string) => void;
  onDiscard: (version: string) => void;
}

function shortHash(hash: string): string {
  return `SHA-256 ${hash.slice(0, 16)}…${hash.slice(-8)}`;
}

function statusText(phase: ManualUiState['persisted']['install']['phase']): string {
  switch (phase) {
    case 'installing':
      return '正在下载并逐项校验';
    case 'ready':
      return '已完整校验，等待激活';
    case 'activating':
      return '正在切换当前代际';
    case 'failed':
      return '安装失败，旧版仍保留';
    default:
      return '空闲';
  }
}

export function ManualView({
  catalog,
  activePackage,
  state,
  online,
  onInstall,
  onCancel,
  onActivate,
  onDiscard
}: ManualViewProps) {
  const install = state.persisted.install;
  const activeVersion = state.activeVersion;

  return (
    <section aria-label="手册安装与断电步骤">
      {!activePackage && (
        <div className="empty-state" role="status">
          <strong>无可用离线包</strong>
          <p>首次安装尚未完整下载并通过 SHA-256 校验。请在联网状态选择一个手册版本。</p>
        </div>
      )}

      {state.lastError && (
        <div className="error" role="alert" style={{ margin: '14px 0' }}>
          {state.lastError.message}（版本 {state.lastError.version}，原因：{state.lastError.reason}）
        </div>
      )}

      <div className="card">
        <h2>内置版本清单</h2>
        <p className="muted">所有资源均为同源 URL。下载完成后校验字节数与 SHA-256，全部通过才允许激活。</p>
        <div className="version-grid">
          {catalog.map((entry) => {
            const entryInstall = install.version === entry.version ? install : { phase: 'idle' as const };
            const isActive = entry.version === activeVersion;
            const isBusy = entryInstall.phase === 'installing';
            const isReady = entryInstall.phase === 'ready';
            const isActivating = entryInstall.phase === 'activating';
            const progress = install.total ? Math.round((install.progress / install.total) * 100) : 0;
            return (
              <article key={entry.version} data-testid={`package-${entry.version}`} className={`version-card ${isActive ? 'active' : ''}`}>
                <div>
                  <h3>{entry.label}</h3>
                  <div className="version-meta">版本号：{entry.version}</div>
                  <div className="version-meta">发布时间：{entry.issuedAt}</div>
                  <div className="version-meta">同源清单：{entry.originUrl}</div>
                  <div className="hash">{shortHash(entry.manifestSha256)}</div>
                </div>
                <div className="badge" aria-label={`状态：${statusText(entryInstall.phase)}`}>
                  {isActive ? '当前完整版本' : entryInstall.phase === 'idle' ? '未安装' : statusText(entryInstall.phase)}
                </div>
                {isBusy && (
                  <>
                    <div className="progress" aria-label={`${entry.version} 安装进度`}>
                      <div style={{ width: `${progress}%` }} />
                    </div>
                    <div className="version-meta">{install.progress}/{install.total} 个文件已校验（{progress}%）</div>
                  </>
                )}
                <div className="actions">
                  {!isActive && !isBusy && !isReady && !isActivating && (
                    <button className="primary" type="button" onClick={() => onInstall(entry.version)} disabled={!online}>
                      下载并校验
                    </button>
                  )}
                  {isBusy && (
                    <button className="danger" type="button" onClick={onCancel}>
                      取消安装
                    </button>
                  )}
                  {isReady && (
                    <>
                      <button className="primary" type="button" onClick={() => onActivate(entry.version)}>
                        激活版本
                      </button>
                      <button className="secondary" type="button" onClick={() => onDiscard(entry.version)}>
                        清理未激活包
                      </button>
                    </>
                  )}
                  {isActivating && <span className="badge">切换中</span>}
                  {isActive && <span className="badge online">离线可用</span>}
                </div>
              </article>
            );
          })}
        </div>
      </div>

      {activePackage && (
        <div className="card">
          <h2>{activePackage.manifest.label}</h2>
          <p className="muted">
            当前版本 {activePackage.manifest.version}。即使断网或刷新，本页步骤仍由 Cache Storage 读取，并再次校验完整性。
          </p>
          <div className="success">当前步骤与版本 {activePackage.manifest.version} 绑定；半包更新不会替换这些步骤。</div>
          <ol className="steps">
            {activePackage.steps.map((step, index) => (
              <li key={`${activePackage.manifest.version}-${index}`}>{step}</li>
            ))}
          </ol>
          <div className="card" style={{ marginTop: 14 }}>
            <h3>{activePackage.notes.title}</h3>
            <p>{activePackage.notes.body}</p>
          </div>
        </div>
      )}
    </section>
  );
}
