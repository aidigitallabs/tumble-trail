import RAPIER from '@dimforge/rapier3d-compat';
import { registerSW } from 'virtual:pwa-register';
import './style.css';
import { App } from './app/App';
import { installTouchGuards } from './app/touchGuards';
import type { TT } from './app/tt';

// Boot: the loading screen (already in index.html) stays up while the WASM initialises.
const tt: TT = {
  state: 'boot',
  stats: () => ({ triangles: 0, drawCalls: 0, fps: 0 }),
  app: { rendererString: null },
  ball: () => ({ pos: [0, 0, 0], vel: [0, 0, 0], t: 0, lateral: 0 }),
};
window.__tt = tt;

async function boot(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const loading = document.getElementById('loading');
  installTouchGuards(canvas);

  await RAPIER.init();
  const app = new App(canvas);

  tt.stats = () => app.stats();
  tt.app = { rendererString: app.rendererString };
  tt.ball = () => {
    const b = app.ballState();
    return { pos: b.pos, vel: b.vel, t: 0, lateral: 0 };
  };

  app.start();
  loading?.classList.add('hidden');
  tt.state = 'title';
}

// Never register the service worker in dev. Updates are applied only on the title screen from
// Phase 4 on; for now we just keep the handle.
if (!import.meta.env.DEV) {
  registerSW({ immediate: true });
}

boot().catch((err: unknown) => {
  console.error('Tumble Trail failed to start', err);
});
