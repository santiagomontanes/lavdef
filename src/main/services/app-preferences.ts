const ElectronStore = require('electron-store').default;

const store = new ElectronStore({
  name: 'lavanderia-settings'
}) as {
  get: (key: string, defaultValue?: unknown) => unknown;
  set: (key: string, value: unknown) => void;
};

const DISABLE_GPU_RENDERING_ON_STARTUP_KEY = 'disableGpuRenderingOnStartup';

export const appPreferences = {
  getDisableGpuRenderingOnStartup() {
    return Boolean(store.get(DISABLE_GPU_RENDERING_ON_STARTUP_KEY, false));
  },

  updateDisableGpuRenderingOnStartup(enabled: boolean) {
    const normalizedEnabled = Boolean(enabled);
    store.set(DISABLE_GPU_RENDERING_ON_STARTUP_KEY, normalizedEnabled);
    return { success: true as const, enabled: normalizedEnabled };
  }
};
