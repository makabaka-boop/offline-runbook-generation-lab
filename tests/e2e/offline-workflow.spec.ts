import { expect, test, type Page } from '@playwright/test';

const OLD_STEP = '按下 QF-A1 维护旁路按钮';
const NEW_STEP = '在触摸屏选择“负载转移到 B 总线”';

async function resetStorage(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((name) => caches.delete(name)));
    const registration = await navigator.serviceWorker.getRegistration('/');
    await registration?.unregister();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('offline-manual-drill');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('IndexedDB 删除被阻塞'));
    });
  });
  await page.reload();
  await expect(page.getByText('无可用离线包')).toBeVisible();
}

async function waitForServiceWorker(page: Page): Promise<void> {
  await page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.getRegistration('/');
    return Boolean(registration?.active || registration?.waiting);
  });
  await page.evaluate(() => navigator.serviceWorker.ready);
}

async function installAndActivateOld(page: Page): Promise<void> {
  await resetStorage(page);
  await waitForServiceWorker(page);
  await page.getByRole('button', { name: '下载并校验', exact: false }).first().click();
  await expect(page.getByRole('button', { name: '激活版本' }).first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: '激活版本' }).first().click();
  await expect(page.getByText(OLD_STEP)).toBeVisible({ timeout: 10_000 });
}

test.describe('离线手册原子安装', () => {
  test.beforeEach(async ({ page }) => {
    await installAndActivateOld(page);
  });

  test('新版下载中断后，离线刷新仍只打开旧版', async ({ page, context }) => {
    await page.route('**/packages/2025.03.2/steps.json', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.abort('failed');
    });

    const cards = page.locator('.version-card');
    const newCard = cards.filter({ hasText: '2025.03.2' });
    await newCard.getByRole('button', { name: '下载并校验' }).click();

    await expect(page.getByText('网络中断或资源无法下载')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(OLD_STEP, { exact: true })).toBeVisible();
    await expect(page.getByText(NEW_STEP, { exact: true })).toHaveCount(0);

    await context.setOffline(true);
    await page.reload();
    await page.reload();
    await expect(page.getByText(OLD_STEP, { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(NEW_STEP, { exact: true })).toHaveCount(0);
    await expect(page.getByText('无可用离线包')).toHaveCount(0);

    const cacheNames = await page.evaluate(() => caches.keys());
    expect(cacheNames).toContain('offline-manual-package-2024.11.0');
    expect(cacheNames).not.toContain('offline-manual-package-2025.03.2');
    await context.setOffline(false);
  });

  test('完整重装并激活后，在线和离线刷新都只显示新版步骤', async ({ page, context }) => {
    const cards = page.locator('.version-card');
    await cards.filter({ hasText: '2025.03.2' }).getByRole('button', { name: '下载并校验' }).click();
    await expect(page.getByRole('button', { name: '激活版本' }).first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '激活版本' }).first().click();

    await expect(page.getByText(NEW_STEP)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(OLD_STEP)).toHaveCount(0);

    await page.reload();
    await expect(page.getByText(NEW_STEP)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(OLD_STEP)).toHaveCount(0);

    await context.setOffline(true);
    await page.reload();
    await page.reload();
    await expect(page.getByText(NEW_STEP, { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(OLD_STEP, { exact: true })).toHaveCount(0);
    const cacheNames = await page.evaluate(() => caches.keys());
    expect(cacheNames).toContain('offline-manual-package-2025.03.2');
    expect(cacheNames).not.toContain('offline-manual-package-2024.11.0');
    await context.setOffline(false);
  });

  test('取消下载不会替换旧版且未激活缓存被清理', async ({ page }) => {
    await page.route('**/packages/2025.03.2/manifest.json', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.continue();
    });

    await page.locator('.version-card').filter({ hasText: '2025.03.2' }).getByRole('button', { name: '下载并校验' }).click();
    await expect(page.getByRole('button', { name: '取消安装' })).toBeVisible();
    await page.getByRole('button', { name: '取消安装' }).click();
    await expect(page.getByText('安装已取消')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(OLD_STEP, { exact: true })).toBeVisible();
    const cacheNames = await page.evaluate(() => caches.keys());
    expect(cacheNames).not.toContain('offline-manual-package-2025.03.2');
  });

  test('配额异常不会替换旧版且未激活缓存被清理', async ({ page }) => {
    await page.addInitScript(() => {
      const originalPut = Cache.prototype.put;
      Cache.prototype.put = function put(request: RequestInfo | URL, response: Response) {
        const url = request instanceof URL ? request.href : request instanceof Request ? request.url : String(request);
        if (url.includes('/packages/2025.03.2/')) {
          throw new DOMException('模拟存储配额不足', 'QuotaExceededError');
        }
        return originalPut.call(this, request, response);
      };
    });
    await page.reload();
    await expect(page.getByText(OLD_STEP, { exact: true })).toBeVisible();

    await page.locator('.version-card').filter({ hasText: '2025.03.2' }).getByRole('button', { name: '下载并校验' }).click();
    await expect(page.getByText('浏览器存储配额不足')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(OLD_STEP, { exact: true })).toBeVisible();
    const cacheNames = await page.evaluate(() => caches.keys());
    expect(cacheNames).not.toContain('offline-manual-package-2025.03.2');
  });

  test('校验失败不会替换旧版且未激活缓存被清理', async ({ page }) => {
    await page.route('**/packages/2025.03.2/notes.json', async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      await route.fulfill({ response, body: `${body}tampered` });
    });

    await page.locator('.version-card').filter({ hasText: '2025.03.2' }).getByRole('button', { name: '下载并校验' }).click();
    await expect(page.getByText('SHA-256 或文件大小校验未通过')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(OLD_STEP, { exact: true })).toBeVisible();
    const cacheNames = await page.evaluate(() => caches.keys());
    expect(cacheNames).not.toContain('offline-manual-package-2025.03.2');
  });
});

test('首次安装失败时显示无可用离线包', async ({ page }) => {
  await resetStorage(page);
  await waitForServiceWorker(page);
  await page.route('**/packages/2024.11.0/faults.json', (route) => route.abort('failed'));
  await page.getByRole('button', { name: '下载并校验' }).first().click();
  await expect(page.getByText('网络中断或资源无法下载')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('无可用离线包')).toBeVisible();
});

test('切换版本会终止未完成演练，完成结论绑定当前版本', async ({ page }) => {
  await installAndActivateOld(page);
  await page.getByRole('button', { name: '离线演练' }).click();
  await page.getByRole('searchbox').fill('指示');
  await page.getByRole('checkbox').first().check();
  await expect(page.getByText('已按当前版手册完成确认')).toBeVisible();

  await page.getByRole('button', { name: '手册与安装' }).click();
  await page.locator('.version-card').filter({ hasText: '2025.03.2' }).getByRole('button', { name: '下载并校验' }).click();
  await expect(page.getByRole('button', { name: '激活版本' }).first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: '激活版本' }).first().click();
  await expect(page.getByText(NEW_STEP)).toBeVisible();

  await page.getByRole('button', { name: '离线演练' }).click();
  await expect(page.getByRole('checkbox')).toHaveCount(3);
  for (const checkbox of await page.getByRole('checkbox').all()) {
    await expect(checkbox).not.toBeChecked();
  }

  const boxes = page.getByRole('checkbox');
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await boxes.nth(2).check();
  await expect(page.getByRole('heading', { name: '离线演练通过' })).toBeVisible();
  await expect(page.getByText(/绑定手册版本\s*2025\.03\.2/)).toBeVisible();
});
