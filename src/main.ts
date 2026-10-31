import RAPIER from '@dimforge/rapier3d-compat';
import { registerSW } from 'virtual:pwa-register';
import './style.css';
import './screens.css';
import { App } from './app/App';
import { Persistence } from './app/Persistence';
import { bootTT, createTT } from './app/tt';
import { installTouchGuards } from './app/touchGuards';

// Boot: the loading screen (already in index.html) stays up while the WASM initialises.
window.__tt = bootTT();

let app: App | null = null;
let updateWaiting: (() => void) | null = null;

async function boot(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const uiRoot = document.getElementById('ui') as HTMLElement;
  const loading = document.getElementById('loading');
  installTouchGuards(canvas);

  await RAPIER.init();
  app = new App(canvas, {
    persistence: new Persistence(),
    version: __APP_VERSION__,
    uiRoot,
  });
  window.__tt = createTT(app);
  // The service worker may have found an update while the WASM was loading.
  if (updateWaiting) app.setUpdateHandler(updateWaiting);

  app.showTitle();
  app.start();
  loading?.classList.add('hidden');
}

// Never register the service worker in dev. A waiting update is applied only on the title screen
// (PLAN section 8): the app holds the handler until it is there.
if (!import.meta.env.DEV) {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      updateWaiting = () => void updateSW(true);
      app?.setUpdateHandler(updateWaiting);
    },
  });
}

boot().catch((err: unknown) => {
  console.error('Tumble Trail failed to start', err);
});
