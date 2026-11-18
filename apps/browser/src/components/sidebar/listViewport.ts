export type ListBand = { top: number; bottom: number };

export type ListViewport = {
  band: () => ListBand | null;
  watch: (listener: () => void) => () => void;
  changed: () => void;
};

export function createListViewport(read: () => ListBand | null): ListViewport {
  const listeners = new Set<() => void>();
  return {
    band: read,
    watch: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    changed: () => {
      for (const listener of [...listeners]) listener();
    },
  };
}

export const shiftedBand = (band: ListBand | null, by: number): ListBand | null => (band ? { top: band.top - by, bottom: band.bottom - by } : null);

export function seenSliding(top: number, height: number, from: number, band: ListBand | null): boolean {
  if (!band) return true;
  const start = Math.min(top, top + from);
  const end = Math.max(top, top + from) + height;
  return end > band.top && start < band.bottom;
}
