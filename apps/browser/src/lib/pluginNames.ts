export const RESERVED_PAGE_NAMES: readonly string[] = [
  "history", "bookmarks", "downloads", "newtab", "settings", "about", "accessibility", "app-service-internals", "apps",
  "attribution-internals", "autofill-internals", "blob-internals", "bluetooth-internals", "chrome", "chrome-urls",
  "components", "connectors-internals", "crashes", "credits", "device-log", "dino", "discards", "download-internals",
  "extensions", "extensions-internals", "flags", "gcm-internals", "gpu", "help", "histograms", "history-clusters-internals",
  "indexeddb-internals", "inspect", "interstitials", "invalidations", "local-state", "management", "media-engagement",
  "media-internals", "memory-internals", "metrics-internals", "net-export", "net-internals", "network-errors",
  "new-tab-page", "ntp-tiles-internals", "omnibox", "optimization-guide-internals", "password-manager",
  "password-manager-internals", "policy", "predictors", "prefs-internals", "print", "process-internals",
  "quota-internals", "reset-password", "safe-browsing", "serviceworker-internals", "signin-internals",
  "site-engagement", "sync-internals", "system", "terms", "topics-internals", "tracing", "translate-internals",
  "ukm", "usb-internals", "user-actions", "version", "web-app-internals", "webrtc-internals", "webrtc-logs",
  "webui-gallery", "whats-new",
];

const PAGE_PATH = /^(\/[A-Za-z0-9._~!$&'()*+,;=:@%-]*)*(\?[^#\s]*)?$/;
export const MAX_PAGE_PATH = 512;

export const isPagePath = (path: string) => path.length <= MAX_PAGE_PATH && (path === "" || PAGE_PATH.test(path)) && !path.split(/[/?]/).some((part) => part === "..");
