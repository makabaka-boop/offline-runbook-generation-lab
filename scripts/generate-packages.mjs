import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packagesDir = join(root, 'public', 'packages');
const generatedDir = join(root, 'src', 'generated');

const PACKAGE_ORIGIN = '/packages';

const sourcePackages = [
  {
    id: 'power-manual',
    version: '2024.11.0',
    label: '旧版断电手册（机房 A 基线）',
    issuedAt: '2024-11-01T08:00:00+08:00',
    steps: [
      '核对事故灯与直流屏，确认正在处理的是 A 列配电柜，而不是相邻 B 列。',
      '在监控终端记录当前负载，并通知值班调度：即将执行 2024.11.0 旧版断电流程。',
      '按下 QF-A1 维护旁路按钮，等待“旁路已投入”指示灯保持常亮 10 秒。',
      '按从小到大顺序断开支路开关 A-LOAD-04、A-LOAD-03、A-LOAD-02，再断开 A-LOAD-01。',
      '最后断开主输入开关 A-MAIN，并挂上“禁止合闸，有人工作”标识牌。',
      '使用万用表确认 A 母排对地电压为 0V，然后在纸质操作票上填写旧版基线完成时间。'
    ],
    faults: [
      {
        id: 'a1-bypass-lamp',
        title: '旁路指示灯不亮',
        symptom: '按下 QF-A1 后旁路灯不亮或闪烁。',
        diagnosis: '检查旁路保险 F-BP1、门限位触点及指示灯接线。',
        action: '不得断开负载；恢复 QF-A1 并等待值班工程师确认。'
      },
      {
        id: 'a2-breaker-stuck',
        title: '支路断路器无法分闸',
        symptom: 'A-LOAD 断路器手柄卡住。',
        diagnosis: '确认机械锁已解除，检查是否存在反向力矩。',
        action: '停止操作主开关，挂牌隔离该支路并上报。'
      }
    ],
    notes: {
      id: 'safety-notes',
      title: '安全要点',
      body: '先旁路、后支路、最后主输入；严禁先断主输入。操作期间双人复诵。'
    }
  },
  {
    id: 'power-manual',
    version: '2025.03.2',
    label: '新版断电手册（双总线修订）',
    issuedAt: '2025-03-18T09:30:00+08:00',
    steps: [
      '核对事故灯、母线编号与二维码资产标签，确认目标为 A 列双总线配电柜。',
      '通知值班调度并在离线操作票中记录负载，明确执行 2025.03.2 双总线修订流程。',
      '投入维护旁路 QF-A1，确认旁路灯、旁路接触器反馈和触摸屏状态三者同时正常。',
      '在触摸屏选择“负载转移到 B 总线”，等待转移进度达到 100% 且 B 总线接收灯常亮。',
      '按从大到小顺序断开 A 列支路 A-LOAD-01、A-LOAD-02、A-LOAD-03、A-LOAD-04。',
      '断开 A 列主输入 A-MAIN，投入机械锁并悬挂新版二维码警示牌。',
      '分别测量 A 母排、旁路端子和备用回路，确认三处均无电压后填写 2025.03.2 完成记录。'
    ],
    faults: [
      {
        id: 'a1-bypass-lamp',
        title: '旁路指示灯不亮',
        symptom: '旁路灯不亮，但接触器可能已经吸合。',
        diagnosis: '同时核对接触器反馈与触摸屏状态，不允许只凭指示灯判断。',
        action: '暂停负载转移；若三路反馈不一致，恢复旁路并上报。'
      },
      {
        id: 'a2-breaker-stuck',
        title: '支路断路器无法分闸',
        symptom: 'A-LOAD 断路器无法断开。',
        diagnosis: '检查机械锁、转移状态以及断路器储能指示。',
        action: '保持 B 总线承载，挂牌隔离该支路并等待工程师。'
      },
      {
        id: 'bus-transfer-fail',
        title: 'B 总线转移未完成',
        symptom: '转移进度停在 100% 以下或接收灯闪烁。',
        diagnosis: '查看 B 总线容量、联锁信号和通信终端电阻。',
        action: '取消转移、恢复 A 列承载；不得断开 A 列支路。'
      }
    ],
    notes: {
      id: 'safety-notes',
      title: '安全要点',
      body: '先完成 B 总线转移，再按从大到小断开 A 列支路；三处验电缺一不可。'
    }
  }
];

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function normalizedJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

const generated = [];

for (const pkg of sourcePackages) {
  const versionPath = `/packages/${pkg.version}`;
  const stepsResource = {
    url: `${versionPath}/steps.json`,
    kind: 'steps',
    bytes: 0,
    sha256: ''
  };
  const faultsResource = {
    url: `${versionPath}/faults.json`,
    kind: 'faults',
    bytes: 0,
    sha256: ''
  };
  const notesResource = {
    url: `${versionPath}/notes.json`,
    kind: 'notes',
    bytes: 0,
    sha256: ''
  };

  const files = [
    { resource: stepsResource, name: 'steps.json', data: pkg.steps },
    { resource: faultsResource, name: 'faults.json', data: pkg.faults },
    { resource: notesResource, name: 'notes.json', data: pkg.notes }
  ];

  for (const file of files) {
    const content = normalizedJson(file.data);
    file.resource.bytes = Buffer.byteLength(content);
    file.resource.sha256 = sha256(content);
  }

  const manifest = {
    schemaVersion: 1,
    id: pkg.id,
    version: pkg.version,
    label: pkg.label,
    issuedAt: pkg.issuedAt,
    originUrl: `${PACKAGE_ORIGIN}/${pkg.version}/manifest.json`,
    steps: pkg.steps,
    resources: files.map(({ resource }) => resource)
  };

  const manifestContent = normalizedJson(manifest);
  const manifestResource = {
    url: `${versionPath}/manifest.json`,
    kind: 'manifest',
    bytes: Buffer.byteLength(manifestContent),
    sha256: sha256(manifestContent)
  };

  for (const file of files) {
    await mkdir(join(packagesDir, pkg.version), { recursive: true });
    await writeFile(join(packagesDir, pkg.version, file.name), normalizedJson(file.data), 'utf8');
  }
  await writeFile(join(packagesDir, pkg.version, 'manifest.json'), manifestContent, 'utf8');

  generated.push({
    id: manifest.id,
    version: manifest.version,
    label: manifest.label,
    issuedAt: manifest.issuedAt,
    originUrl: manifest.originUrl,
    manifestSha256: manifestResource.sha256,
    manifestBytes: manifestResource.bytes,
    resources: manifest.resources
  });
}

await rm(generatedDir, { recursive: true, force: true });
await mkdir(generatedDir, { recursive: true });
await writeFile(
  join(generatedDir, 'catalog.json'),
  normalizedJson({ schemaVersion: 1, packages: generated }),
  'utf8'
);
await writeFile(
  join(generatedDir, 'catalog.ts'),
  [
    'import catalogJson from "./catalog.json";',
    'import type { CatalogEntry } from "../types";',
    '',
    'export const catalog = catalogJson.packages as unknown as readonly CatalogEntry[];',
    ''
  ].join('\n'),
  'utf8'
);

await readFile(join(generatedDir, 'catalog.ts'), 'utf8');
console.log(`Generated ${generated.length} signed offline packages.`);
