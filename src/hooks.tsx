import { useEffect, useRef } from 'react';

/**
 * A React hook that runs the provided callback exactly once.
 */
export const useOnce = (cb: () => void) => {
  const run = useRef(false);

  useEffect(() => {
    if (!run.current) {
      cb();
      run.current = true;
    }
  });
};
