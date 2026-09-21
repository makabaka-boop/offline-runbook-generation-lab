import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { catalog } from './generated/catalog';
import type { VerifiedPackage } from './types';
import { ManualCoordinator } from './lib/coordinator';
import { isSupportedEnvironment, missingCapabilities } from './lib/support';
import { initialManualState, manualReducer, type ManualAction } from './state/manualReducer';
import { drillReducer, initialDrillState, type DrillAction } from './state/drillReducer';
import { ManualView } from './components/ManualView';
import { DrillView } from './components/DrillView';
import './styles.css';

type Tab = 'manual' | 'drill';

export default function App() {
  const supported = useMemo(() => isSupportedEnvironment(), []);
  const missing = useMemo(() => (supported ? [] : missingCapabilities()), [supported]);
  const [manual, manualDispatch] = useReducer(manualReducer, initialManualState);
  const [drill, drillDispatch] = useReducer(drillReducer, initialDrillState);
  const [activePackage, setActivePackage] = useState<VerifiedPackage | null>(null);
  const [registrationFailed, setRegistrationFailed] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [tab, setTab] = useState<Tab>('manual');
  const coordinator = useMemo(() => new ManualCoordinator((action: ManualAction) => manualDispatch(action)), []);

  useEffect(() => {
    let cancelled = false;
    async function start() {
      if (!supported) return;
      try {
        await coordinator.registerServiceWorker();
        const result = await coordinator.bootstrap();
        if (cancelled) return;
        manualDispatch({
          type: 'BOOTSTRAP_COMPLETE',
          state: result.state,
          activeVersion: result.state.currentVersion
        });
        setActivePackage(result.activePackage);
      } catch (error) {
        console.error('离线状态恢复失败', error);
        if (!cancelled) setRegistrationFailed(true);
      }
    }
    start().catch((error) => {
      console.error('离线状态恢复失败', error);
      setRegistrationFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [coordinator, supported]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    addEventListener('online', update);
    addEventListener('offline', update);
    return () => {
      removeEventListener('online', update);
      removeEventListener('offline', update);
    };
  }, []);

  useEffect(() => {
    if (!activePackage) return;
    drillDispatch({
      type: 'VERSION_SWITCHED',
      version: activePackage.manifest.version,
      faults: activePackage.faults
    });
  }, [activePackage?.manifest.version]);

  const handleInstall = useCallback((version: string) => void coordinator.install(version), [coordinator]);
  const handleCancel = useCallback(() => coordinator.cancelInstall(), [coordinator]);
  const handleDiscard = useCallback((version: string) => void coordinator.discardReady(version), [coordinator]);
  const handleActivate = useCallback(
    (version: string) =>
      coordinator.activate(version).then((activated) => {
        if (activated) setActivePackage(activated);
      }),
    [coordinator]
  );

  if (!supported || registrationFailed) {
    return (
      <main className="unsupported">
        <section className="card">
          <h1>当前浏览器无法保证离线完整性</h1>
          <div className="unsupported-code">UNSUPPORTED</div>
          <p>需要 Service Worker、Cache Storage、IndexedDB、Web Crypto、Fetch 与安全上下文。</p>
          {missing.length > 0 && <p>缺失能力：{missing.join('、')}</p>}
          {registrationFailed && <p>Service Worker 注册被浏览器或站点策略阻止。</p>}
          <p className="muted">请使用最新版 Chrome/Edge/Firefox，并通过 HTTPS、localhost 或 127.0.0.1 访问。</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <h1>机房断电手册 · 离线演练</h1>
          <p>断网后仍只读取完整校验的当前代际；未激活下载不会替换旧手册。</p>
        </div>
        <div className="badges">
          <span className={`badge ${online ? 'online' : 'offline'}`}>{online ? '网络在线' : '网络中断 / 离线'}</span>
          <span className="badge">当前版本：{manual.activeVersion ?? '无'}</span>
        </div>
      </header>

      <nav className="tabs" aria-label="功能切换">
        <button className={`tab ${tab === 'manual' ? 'active' : ''}`} type="button" onClick={() => setTab('manual')}>
          手册与安装
        </button>
        <button className={`tab ${tab === 'drill' ? 'active' : ''}`} type="button" onClick={() => setTab('drill')}>
          离线演练
        </button>
      </nav>

      {!manual.bootstrapped && <div className="card">正在恢复当前代际并校验缓存……</div>}
      {manual.bootstrapped && tab === 'manual' && (
        <ManualView
          catalog={catalog}
          activePackage={activePackage}
          state={manual}
          online={online}
          onInstall={handleInstall}
          onCancel={handleCancel}
          onActivate={handleActivate}
          onDiscard={handleDiscard}
        />
      )}
      {manual.bootstrapped && tab === 'drill' && (
        <DrillView
          activePackage={activePackage}
          drillState={drill}
          dispatch={(action: DrillAction) => drillDispatch(action)}
        />
      )}
    </main>
  );
}
