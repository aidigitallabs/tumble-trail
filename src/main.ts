import RAPIER from '@dimforge/rapier3d-compat';
import { registerSW } from 'virtual:pwa-register';
import './style.css';
import { App } from './app/App';
import { bootTT, createTT } from './app/tt';
import { installTouchGuards } from './app/touchGuards';

// Boot: the loading screen (already in index.html) stays up while the WASM initialises.
window.__tt = bootTT();

async function boot(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const loading = document.getElementById('loading');
  installTouchGuards(canvas);

  await RAPIER.init();
  const app = new App(canvas);
  window.__tt = createTT(app);

  // Phase 1b: straight into the test course (title and level select arrive in Phase 4).
  await app.loadLevel('levelTest');
  app.start();
  loading?.classList.add('hidden');
}

// Never register the service worker in dev. Updates are applied only on the title screen from
// Phase 4 on; for now we just keep the handle.
if (!import.meta.env.DEV) {
  registerSW({ immediate: true });
}

boot().catch((err: unknown) => {
  console.error('Tumble Trail failed to start', err);
});
