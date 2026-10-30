// After a change (ack an alert, save an incident) every view showing that data
// should reload at once instead of waiting for its next poll. useApi listens here
// and reloads when its key starts with one of the given prefixes.
type Listener = (prefixes: string[]) => void;
const listeners = new Set<Listener>();

export function invalidate(...prefixes: string[]) {
  listeners.forEach((l) => l(prefixes));
}

export function onInvalidate(l: Listener) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
