export interface UpdateState {
  status: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'installing' | 'error';
  enabled: boolean;
  currentVersion: string;
  latestVersion?: string;
  percent?: number;
  message?: string;
}
interface DesktopBridge {
  savePdf: (name: string) => Promise<boolean>;
  onBeforeClose: (handler: () => Promise<void>) => () => void;
  getUpdateState: () => Promise<UpdateState>;
  checkUpdates: () => Promise<UpdateState>;
  downloadUpdate: () => Promise<UpdateState>;
  installUpdate: () => Promise<UpdateState>;
  onUpdateState: (handler: (state: UpdateState) => void) => () => void;
  onUpdatePanel: (handler: () => void) => () => void;
}
declare global { interface Window { trustDesktop?: DesktopBridge } }
export const desktop = typeof window === 'undefined' ? undefined : window.trustDesktop;
export const isDesktop = !!desktop;
