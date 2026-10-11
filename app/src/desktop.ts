interface DesktopBridge {
  savePdf: (name: string) => Promise<boolean>;
  onBeforeClose: (handler: () => Promise<void>) => () => void;
}
declare global { interface Window { trustDesktop?: DesktopBridge } }
export const desktop = typeof window === 'undefined' ? undefined : window.trustDesktop;
export const isDesktop = !!desktop;
