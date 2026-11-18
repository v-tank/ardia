import { useSyncExternalStore } from "react";
import { AccessibilityInfo } from "react-native";

let on = false;
const listeners = new Set<() => void>();
let started = false;

function start() {
  if (started) return;
  started = true;
  const set = (value: boolean) => {
    if (value === on) return;
    on = value;
    for (const listener of [...listeners]) listener();
  };
  AccessibilityInfo.isScreenReaderEnabled?.().then(set, () => {});
  AccessibilityInfo.addEventListener?.("screenReaderChanged", set);
}

function watch(listener: () => void) {
  start();
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export const useScreenReader = () => useSyncExternalStore(watch, () => on);
