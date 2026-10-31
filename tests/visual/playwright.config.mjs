import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: 'game-page.spec.mjs', workers: 2, timeout: 30000,
  outputDir: '../../visual-results/test-output',
  reporter: [['list'], ['html', { outputFolder: '../../visual-results/playwright', open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:4178', locale: 'id-ID', timezoneId: 'Asia/Makassar', reducedMotion: 'reduce', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [{ name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } }, { name: 'compact', use: { viewport: { width: 1024, height: 768 } } }],
  webServer: { command: 'node server.mjs', url: 'http://127.0.0.1:4178', reuseExistingServer: false },
});
