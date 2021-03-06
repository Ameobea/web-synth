import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { Store } from 'redux';
import { Provider } from 'react-redux';
import { QueryClient, QueryClientProvider } from 'react-query';
import * as R from 'ramda';

import { genRandomStringID } from 'src/util';

interface ContainerRenderHelperArgs<P extends { [key: string]: any } = Record<any, never>> {
  /**
   * The component to render into the container
   */
  Comp: React.FC<P>;
  /**
   * If provided, `Comp` will be wrapped with a `<Provider>` using this as its store
   */
  store?: Store;
  /**
   * A function that will be called at the end of successfully rendering `Comp` into the container
   */
  predicate?: (domId: string, node: HTMLElement) => void;
  /**
   * The props to be passed to the rendered component
   */
  getProps: () => P;
  /**
   * If `true`, the rendered component will be wrapped with a `react-query` `QueryClientProvider`
   */
  enableReactQuery?: boolean;
}

const RootsByID: Map<string, unknown> = new Map();

/**
 * Higher order function that returns a function that handles rendering the provided `Comp` into the container with the
 * id specified by the argument passed into the generated function.  Useful for implementing `renderSmallView`.
 */
export function mkContainerRenderHelper<P extends { [key: string]: any } = Record<any, never>>({
  Comp,
  store,
  predicate,
  getProps,
  enableReactQuery,
}: ContainerRenderHelperArgs<P>) {
  return (domId: string) => {
    const node = document.getElementById(domId);
    if (!node) {
      console.error(`No node with id ${domId} found when trying to render up small view`);
      return;
    }

    const props = getProps();

    // Check to see if we've already created a root for this node
    let root;
    const existingRootID = node.getAttribute('data-react-root-id');
    if (existingRootID) {
      root = RootsByID.get(existingRootID);
      if (!root) {
        throw new Error(
          'Node was marked as having a root, but entry has been removed from the roots map'
        );
      }
    } else {
      root = ReactDOM.unstable_createRoot(node);
      const rootID = genRandomStringID();
      node.setAttribute('data-react-root-id', rootID);
      RootsByID.set(rootID, root);
    }

    const wrap = R.compose(
      (rendered: React.ReactNode) => {
        if (store) {
          return <Provider store={store}>{rendered}</Provider>;
        }
        return rendered;
      },
      (rendered: React.ReactNode) => {
        if (enableReactQuery) {
          return (
            <QueryClientProvider client={getReactQueryClient()}>{rendered}</QueryClientProvider>
          );
        }
        return rendered;
      }
    );
    const rendered = wrap(<Comp {...props} />);
    root.render(rendered);

    if (predicate) {
      predicate(domId, node);
    }
  };
}

/**
 * Complement of `mkContainerRenderHelper`.  HOF that tears down the React component rendered into the container
 * pointed to by the id passed into the returned function.
 */
export const mkContainerCleanupHelper = ({
  preserveRoot,
  predicate,
}: {
  predicate?: (domID: string, node: HTMLElement) => void;
  /**
   * If `true`, the DOM element will not be deleted.  If `false` or not provided, it will be deleted.
   */
  preserveRoot?: boolean;
} = {}) => (domId: string) => {
  const node = document.getElementById(domId);
  if (!node) {
    console.error(`No node with id ${domId} found when trying to clean up small view`);
    return;
  }
  if (predicate) {
    predicate(domId, node);
  }

  const rootID = node.getAttribute('data-react-root-id');
  if (!rootID) {
    return;
  }
  const root = RootsByID.get(rootID);
  if (!root) {
    console.error('No root in map in container render helper when cleaning up');
    return;
  }

  if (preserveRoot) {
    root.render(null);
  } else {
    node.remove();
    RootsByID.delete(rootID);
    root.unmount();
  }
};

export const mkContainerHider = (getContainerID: (vcId: string) => string) => (
  stateKey: string
) => {
  const vcId = stateKey.split('_')[1]!;
  const elemID = getContainerID(vcId);
  const elem = document.getElementById(elemID);
  if (!elem) {
    console.error(`Unable to find DOM element with vcId=${vcId} id=${elemID}; can't hide.`);
    return;
  }

  elem.style.display = 'none';
};

export const mkContainerUnhider = (getContainerID: (vcId: string) => string, display = 'block') => (
  stateKey: string
) => {
  const vcId = stateKey.split('_')[1]!;
  const elemID = getContainerID(vcId);
  const elem = document.getElementById(elemID);
  if (!elem) {
    console.error(`Unable to find DOM element with vcId=${vcId} id=${elemID}; can't unhide.`);
    return;
  }

  elem.style.display = display;
};

// Taken from: https://usehooks.com/useWindowSize/
export function useWindowSize() {
  // Initialize state with undefined width/height so server and client renders match
  // Learn more here: https://joshwcomeau.com/react/the-perils-of-rehydration/
  const [windowSize, setWindowSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  useEffect(() => {
    // Handler to call on window resize
    function handleResize() {
      // Set window width/height to state
      setWindowSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    }

    // Add event listener
    window.addEventListener('resize', handleResize);

    // Call handler right away so state gets updated with initial window size
    handleResize();

    // Remove event listener on cleanup
    return () => window.removeEventListener('resize', handleResize);
  }, []); // Empty array ensures that effect is only run on mount

  return windowSize;
}

// Taken from https://usehooks.com/useWhyDidYouUpdate/
export function useWhyDidYouUpdate<T extends { [key: string]: any }>(name: string, props: T) {
  // Get a mutable ref object where we can store props ...
  // ... for comparison next time this hook runs.
  const previousProps = useRef<T | undefined>();

  useEffect(() => {
    if (previousProps.current) {
      // Get all keys from previous and current props
      const allKeys = Object.keys({ ...previousProps.current, ...props });
      // Use this object to keep track of changed props
      const changesObj: any = {};
      // Iterate through keys
      allKeys.forEach(key => {
        // If previous is different from current
        if (previousProps.current![key] !== props[key]) {
          // Add to changesObj
          changesObj[key] = {
            from: previousProps.current![key],
            to: props[key],
          };
        }
      });

      // If changesObj not empty then output to console
      if (Object.keys(changesObj).length) {
        console.log('[why-did-you-update]', name, changesObj);
      }
    }

    // Finally update previousProps with current props for next hook call
    previousProps.current = props;
  });
}

const ReactQueryClient = new QueryClient();

export const getReactQueryClient = (): QueryClient => ReactQueryClient;

export function withReactQueryClient<T extends Record<string, any>>(
  Comp: React.ComponentType<T>
): React.ComponentType<T> {
  const WithReactQueryClient: React.FC<T> = ({ ...props }) => (
    <QueryClientProvider client={ReactQueryClient}>
      <Comp {...props} />
    </QueryClientProvider>
  );
  return WithReactQueryClient;
}
