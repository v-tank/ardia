import type { ReactElement } from "react";

const svg = (path: ReactElement) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {path}
  </svg>
);

export const Icon = {
  stop: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" />
    </svg>
  ),
  check: svg(<path d="m3.5 8.5 3 3 6-7" />),
  x: svg(<path d="m4.5 4.5 7 7m0-7-7 7" />),
  chevron: svg(<path d="m5 6.5 3 3 3-3" />),
};
