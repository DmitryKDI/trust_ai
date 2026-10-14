import type { Project } from '../model/types';

/** Serialize writes; retain the newest unsaved version after failures. */
export class Autosave {
  private pending: Project | null = null;
  private running: Promise<void> | null = null;
  get dirty() { return this.pending !== null || this.running !== null; }
  constructor(private write: (p: Project) => Promise<unknown>, private status: (saving: boolean, error: string | null) => void) {}
  schedule(p: Project) { this.pending = p; this.status(true, null); }
  flush(): Promise<void> {
    if (this.running) return this.running;
    if (!this.pending) return Promise.resolve();
    this.status(true, null);
    this.running = (async () => {
      try {
        while (this.pending) {
          const p = this.pending;
          await this.write({ ...p, updatedAt: new Date().toISOString() });
          if (this.pending === p) this.pending = null;
        }
        this.status(false, null);
      } catch (e) {
        this.status(false, e instanceof Error ? e.message : String(e));
        throw e;
      } finally { this.running = null; }
    })();
    return this.running;
  }
}
