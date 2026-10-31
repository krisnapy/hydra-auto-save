import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const screenshots = fileURLToPath(new URL('../../visual-results/screenshots/', import.meta.url));
const panel = page => page.getByRole('region', { name: 'Personal Cloud Backup' });
async function visit(page, scenario) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`/?scenario=${scenario}`);
  await expect(panel(page).getByRole('button', { name: 'Backup sekarang', exact: true })).toBeVisible();
  await expect(page.getByText('UJI TAMPILAN', { exact: false })).toBeVisible();
  return errors;
}
const cases = ['unconfigured', 'backing-up', 'complete', 'history', 'restoring', 'error'];
for (const scenario of cases) test(`tampilan ${scenario}`, async ({ page }, info) => {
  const errors = await visit(page, scenario);
  const section = panel(page);
  if (scenario === 'unconfigured') {
    await expect(section.getByText('Lokasi save belum dikenali.', { exact: false })).toBeVisible();
    await expect(section.getByRole('button', { name: 'Backup sekarang', exact: true })).toBeDisabled();
    await expect(section.getByRole('button', { name: 'Pulihkan', exact: true })).toBeDisabled();
  } else {
    await expect(section.getByRole('button', { name: 'Buka folder save', exact: true })).toHaveCount(1);
    await expect(section.getByText('slot-1.sav', { exact: false })).toHaveCount(0);
  }
  if (scenario === 'backing-up' || scenario === 'restoring') {
    await expect(section.getByRole('progressbar')).toHaveAttribute('aria-valuenow', scenario === 'restoring' ? '50' : '40');
    await expect(section.getByRole('progressbar')).toBeVisible();
  }
  if (scenario === 'complete') await expect(section.getByText('Backup lokal selesai', { exact: true }).first()).toBeVisible();
  if (scenario === 'history') {
    await section.getByRole('button', { name: 'Pulihkan', exact: true }).click();
    await expect(section.getByRole('button', { name: /^Pulihkan versi/ })).toHaveCount(3);
    await expect(section.getByText('10 file · Backup pengaman')).toBeVisible();
  }
  if (scenario === 'error') await expect(section.getByRole('alert').first()).toBeVisible();
  expect(await section.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const overflow = await section.locator('button').evaluateAll(buttons => buttons.some(button => button.scrollWidth > button.clientWidth + 2));
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
  await fs.mkdir(screenshots, { recursive: true });
  const file = path.join(screenshots, `${info.project.name}-${scenario}.png`);
  await page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
  await info.attach(scenario, { path: file, contentType: 'image/png' });
});

test('backup dan pemulihan memperbarui panel; pembatalan tidak memulihkan', async ({ page }) => {
  await visit(page, 'history');
  const section = panel(page);
  await section.getByRole('button', { name: 'Backup sekarang', exact: true }).click();
  await expect(section.getByRole('progressbar')).toBeVisible();
  await expect(section.getByText('Backup lokal selesai. Riwayat diperbarui.', { exact: true })).toBeVisible();
  await section.getByRole('button', { name: 'Pulihkan', exact: true }).click();
  page.once('dialog', dialog => dialog.dismiss());
  await section.getByRole('button', { name: /^Pulihkan versi/ }).first().click();
  await expect(section.getByText('Pemulihan dibatalkan.', { exact: true })).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await section.getByRole('button', { name: /^Pulihkan versi/ }).first().click();
  await expect(section.getByRole('progressbar')).toBeVisible();
  await expect(section.getByText('Pemulihan selesai.', { exact: true })).toBeVisible();
});
test('tombol folder mengirim ID tersimpan tanpa path dari tampilan', async ({ page }) => {
  await visit(page, 'complete');
  await panel(page).getByRole('button', { name: 'Buka folder save', exact: true }).click();
  const call = await page.evaluate(() => window.visualFixture.calls.find(call => call.action === 'open-save'));
  expect(call).toEqual({ action: 'open-save', gameId: 'custom:visual-fixture', rootId: 'save-one' });
});
test('progres berubah mengikuti status operasi', async ({ page }) => {
  await visit(page, 'backing-up');
  const bar = panel(page).getByRole('progressbar');
  await expect(bar).toHaveAttribute('aria-valuenow', '40');
  await page.evaluate(() => window.visualFixture.setProgress(7));
  await expect(bar).toHaveAttribute('aria-valuenow', '70');
  await expect(panel(page).getByText('7 dari 10 file pada tahap ini')).toBeVisible();
});
test('kegagalan permintaan ditampilkan sebagai alert', async ({ page }) => {
  await visit(page, 'error');
  await panel(page).getByRole('button', { name: 'Backup sekarang', exact: true }).click();
  await expect(panel(page).getByRole('alert').first()).toContainText('Ruang penyimpanan tidak cukup');
  await expect(panel(page).getByRole('button', { name: 'Backup sekarang', exact: true })).toBeEnabled();
});

 test('riwayat dan options tersembunyi; pilihan lokasi tetap dapat diakses', async ({ page }) => {
  await visit(page, 'complete');
  const section = panel(page);
  await expect(section.getByRole('button', { name: /^Pulihkan versi/ })).toHaveCount(0);
  await expect(section.getByRole('button', { name: 'Pilih file save', exact: true })).toHaveCount(0);
  await section.getByRole('button', { name: 'Pilihan backup' }).click();
  await expect(section.getByRole('button', { name: 'Pilih file save', exact: true })).toBeVisible();
  await section.getByRole('button', { name: 'Pulihkan', exact: true }).click();
  await expect(section.getByRole('button', { name: /^Pulihkan versi/ })).toHaveCount(1);
  await section.getByRole('button', { name: 'Tutup riwayat' }).click();
  await expect(section.getByRole('button', { name: /^Pulihkan versi/ })).toHaveCount(0);
});

test('hasil backup otomatis langsung menyegarkan jumlah versi', async ({ page }) => {
  await visit(page, 'backing-up');
  await expect(panel(page).getByRole('progressbar')).toBeVisible();
  await page.evaluate(() => window.visualFixture.completeAutomatic());
  await expect(panel(page).getByText('1 versi di perangkat ini', { exact: true })).toBeVisible();
  await expect(panel(page).getByRole('progressbar')).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: 'Pulihkan', exact: true })).toBeEnabled();
});

test('OneDrive login displays only the user code and can be cancelled', async ({ page }) => {
  await visit(page, 'complete');
  const cloud = page.getByLabel('OneDrive langsung');
  await cloud.getByText('Atur koneksi OneDrive').click();
  await cloud.getByLabel('Microsoft client ID').fill('11111111-2222-3333-4444-555555555555');
  await cloud.getByRole('button', { name: 'Hubungkan OneDrive' }).click();
  await expect(cloud.getByText('ABCD-EFGH', { exact: true })).toBeVisible();
  await expect(cloud.getByRole('button', { name: 'Buka login Microsoft' })).toBeVisible();
  await cloud.getByRole('button', { name: 'Batalkan login' }).click();
  await expect(cloud.getByText('Belum terhubung', { exact: true })).toBeVisible();
});

test('OneDrive download enters local history without starting restore', async ({ page }) => {
  await visit(page, 'complete');
  await page.evaluate(() => window.visualFixture.connectCloud());
  const cloud = page.getByLabel('OneDrive langsung');
  await expect(cloud.getByText('Terhubung', { exact: true })).toBeVisible({ timeout: 8000 });
  await cloud.getByRole('button', { name: 'Lihat versi OneDrive' }).click();
  await cloud.getByRole('button', { name: 'Unduh ke riwayat' }).click();
  await expect(cloud.getByText('Save belum diganti.', { exact: false })).toBeVisible();
  const calls = await page.evaluate(() => window.visualFixture.calls);
  expect(calls.some(call => call.command === 'download')).toBe(true);
  expect(calls.some(call => call.action === 'restore')).toBe(false);
});
