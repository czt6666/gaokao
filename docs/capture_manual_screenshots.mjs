import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';
import path from 'path';

const OUT = path.resolve(import.meta.dirname, 'manual-assets');
const BASE = 'https://www.theyuanxi.cn';
const VIEWPORT = { width: 390, height: 844 }; // iPhone 14 Pro

const shots = [
  { name: '01-home', url: `${BASE}/`, wait: 3000 },
  { name: '02-pricing', url: `${BASE}/pricing`, wait: 2000 },
  { name: '03-results', url: `${BASE}/results?province=${encodeURIComponent('北京')}&rank=28000&subject=${encodeURIComponent('物理,化学,生物')}`, wait: 8000 },
  { name: '04-dashboard', url: `${BASE}/dashboard`, wait: 2000 },
];

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 2,
  locale: 'zh-CN',
});
const page = await context.newPage();

for (const s of shots) {
  try {
    await page.goto(s.url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(s.wait);
    const file = path.join(OUT, `${s.name}.png`);
    await page.screenshot({ path: file, fullPage: false });
    console.log('OK', file);
  } catch (e) {
    console.error('FAIL', s.name, e.message);
  }
}

await browser.close();
console.log('done');
