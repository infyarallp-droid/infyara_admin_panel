import { useCallback, useRef } from 'react';

/**
 * Run an action at most once at a time.
 *
 * A `disabled` button only takes effect after React re-renders, so a fast
 * double/triple click can fire the handler several times first. This guard is
 * synchronous: the extra clicks are dropped before any request is sent. (The
 * server still protects itself — this just keeps the screen from showing the
 * outcome of a duplicate request.)
 */
export function useSingleFlight() {
  const inFlight = useRef(false);
  return useCallback((action: () => Promise<unknown>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    action()
      .catch(() => {
        /* the caller's own onError already reports the failure */
      })
      .finally(() => {
        inFlight.current = false;
      });
  }, []);
}
