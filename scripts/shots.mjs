// Screenshot script: starts the dev server, opens fixed camera positions in a
// headless browser, writes PNGs to shots/.
//
//   npm run shots                 all shots
//   npm run shots -- hub overview only these
//
// Each shot may name a scenario (see src/debug/scenarios.ts) and a number of
// ticks to run before the picture.

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

// Playwright is not a project dependency; use whichever is installed globally.
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const SHOTS = [
  { name: 'overview', cam: { x: 128, z: 128, dist: 200, yaw: -30, pitch: 50 } },
  { name: 'hub', cam: { x: 134, z: 136, dist: 60, yaw: -30, pitch: 45 } },
  { name: 'plateau', cam: { x: 180, z: 80, dist: 90, yaw: 150, pitch: 40 } },
  { name: 'low-angle', cam: { x: 128, z: 128, dist: 120, yaw: 20, pitch: 35 } },
  { name: 'm1-buildings', scenario: 'm1', ticks: 600, cam: { x: 140, z: 118, dist: 55, yaw: -35, pitch: 45 } },
  { name: 'm1-close', scenario: 'm1', ticks: 600, cam: { x: 150, z: 106, dist: 28, yaw: -40, pitch: 40 } },
  { name: 'm2-factory', scenario: 'm2', ticks: 5400, cam: { x: 140, z: 122, dist: 85, yaw: -25, pitch: 50 } },
  { name: 'm2-close', scenario: 'm2', ticks: 5400, cam: { x: 140, z: 118, dist: 40, yaw: -35, pitch: 42 } },
  { name: 'm2-hub', scenario: 'm2', ticks: 5400, cam: { x: 128, z: 134, dist: 30, yaw: -20, pitch: 45 } },
  { name: 'm2-starved', scenario: 'm2-small', ticks: 5400, cam: { x: 140, z: 122, dist: 70, yaw: -25, pitch: 50 } },
];

const PORT = 5199;
const only = process.argv.slice(2);
const shots = only.length ? SHOTS.filter((s) => only.includes(s.name)) : SHOTS;
const W = Number(process.env.SHOT_W ?? 1600);
const H = Number(process.env.SHOT_H ?? 1000);

mkdirSync('shots', { recursive: true });
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], {
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => {
    if (String(d).includes('Local')) resolve();
  });
  server.on('exit', () => reject(new Error('vite exited')));
});

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  for (const s of shots) {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    page.on('pageerror', (e) => console.error(`[${s.name}] page error:`, e.message));
    page.on('console', (m) => { if (m.type() === 'error') console.error(`[${s.name}]`, m.text()); });
    const q = new URLSearchParams({ noedge: '1', paused: '1' });
    if (s.scenario) q.set('scenario', s.scenario);
    await page.goto(`http://localhost:${PORT}/?${q}`);
    await page.waitForFunction(() => window.__game?.ready, null, { timeout: 60000 });
    await page.evaluate(({ cam, ticks, js }) => {
      const g = window.__game;
      if (js) new Function('g', js)(g);
      if (ticks) g.game.warp(ticks);
      g.setCam({ x: cam.x, z: cam.z, dist: cam.dist, yaw: (cam.yaw * Math.PI) / 180, pitch: (cam.pitch * Math.PI) / 180 });
      g.renderNow();
    }, { cam: s.cam, ticks: s.ticks ?? 0, js: process.env.SHOT_JS });
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__game.renderNow());
    await page.screenshot({ path: `shots/${s.name}.png` });
    console.log(`shots/${s.name}.png`);
    await page.close();
  }
} finally {
  await browser.close();
  server.kill();
}
process.exit(0);
