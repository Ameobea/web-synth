import * as R from 'ramda';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from 'react-query';
import { Provider, useStore } from 'react-redux';
import type { AnyAction, Store } from 'redux';
import { type Readable, type Writable, get } from 'svelte/store';

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

const RootsByID: Map<string, Root> = new Map();

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
  return (domID: string) => {
    const node = document.getElementById(domID);
    if (!node) {
      console.error(`No node with id ${domID} found when trying to render up small view`);
      return;
    }

    const props = getProps();

    // Check to see if we've already created a root for this node and unmount it if so
    let root: Root;
    const existingRootID = node.getAttribute('data-react-root-id');
    if (existingRootID) {
      root = RootsByID.get(existingRootID)!;
      if (!root) {
        throw new Error(
          'Node was marked as having a root, but entry has been removed from the roots map'
        );
      }
      root.render(<></>);
    } else {
      root = createRoot(node);
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
    // This seems to be necessary to get small views using the same component to update correctly
    // when selecting a different node of the same type in the graph editor.
    //
    // It works in conjunction with rendering the empty fragment above.
    setTimeout(() => root.render(rendered));

    if (predicate) {
      predicate(domID, node);
    }
  };
}

interface MkContainerCleanupHelperArgs {
  predicate?: (domID: string, node: HTMLElement) => void;
  /**
   * If `true`, the DOM element will not be deleted.  If `false` or not provided, it will be deleted.
   */
  preserveRoot?: boolean;
}

/**
 * Complement of `mkContainerRenderHelper`.  HOF that tears down the React component rendered into the container
 * pointed to by the id passed into the returned function.
 */
export const mkContainerCleanupHelper =
  ({ preserveRoot, predicate }: MkContainerCleanupHelperArgs = {}) =>
  (domID: string) => {
    const node = document.getElementById(domID);
    if (!node) {
      console.error(`No node with id ${domID} found when trying to clean up small view`);
      return;
    }

    predicate?.(domID, node);

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
      root.render(<></>);
    } else {
      node.remove();
      RootsByID.delete(rootID);
      root.unmount();
    }
  };

export const mkContainerHider =
  (getContainerID: (vcId: string) => string) => (stateKey: string) => {
    const vcId = stateKey.split('_')[1]!;
    const elemID = getContainerID(vcId);
    const elem = document.getElementById(elemID);
    if (!elem) {
      console.error(`Unable to find DOM element with vcId=${vcId} id=${elemID}; can't hide.`);
      return;
    }

    elem.style.display = 'none';
  };

export const mkContainerUnhider =
  (getContainerID: (vcId: string) => string, display = 'block') =>
  (stateKey: string) => {
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
    // handleResize();

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

export function withReactQueryClient<T>(Comp: React.ComponentType<T>): React.ComponentType<T> {
  const client = new QueryClient();
  const WithReactQueryClient: React.FC<T> = ({ ...props }) => (
    <QueryClientProvider client={client}>
      <Comp {...(props as any)} />
    </QueryClientProvider>
  );
  return WithReactQueryClient;
}

export function withReduxProvider<T>(
  store: Store<any, AnyAction>,
  Comp: React.ComponentType<T>
): React.ComponentType<T> {
  const WithReduxProvider: React.FC<T> = ({ ...props }) => (
    <Provider store={store}>
      <Comp {...(props as any)} />
    </Provider>
  );
  return WithReduxProvider;
}

export const useDraggable = (
  onDrag: (newPos: { x: number; y: number }) => void,
  position: { x: number; y: number }
) => {
  const dragDownPos = useRef<{
    originalPos: { x: number; y: number };
    downPos: { x: number; y: number };
  }>({
    originalPos: { x: 0, y: 0 },
    downPos: { x: 0, y: 0 },
  });
  const [isDragging, setIsDragging] = useState(false);
  useEffect(() => {
    if (!isDragging) {
      return;
    }

    const upCb = () => setIsDragging(false);
    const moveCb = (e: MouseEvent) => {
      const { originalPos, downPos } = dragDownPos.current;
      const deltaX = e.clientX - downPos.x;
      const deltaY = e.clientY - downPos.y;
      const newPos = { x: originalPos.x + deltaX, y: originalPos.y + deltaY };

      onDrag(newPos);
    };
    window.addEventListener('mousemove', moveCb);
    window.addEventListener('mouseup', upCb);

    return () => {
      window.removeEventListener('mousemove', moveCb);
      window.removeEventListener('mouseup', upCb);
    };
  }, [isDragging, onDrag]);

  const onMouseDown = useCallback(
    (evt: React.MouseEvent) => {
      if (evt.button !== 0) {
        return;
      }

      dragDownPos.current = {
        originalPos: position,
        downPos: { x: evt.clientX, y: evt.clientY },
      };
      setIsDragging(true);
    },
    [position]
  );
  return { isDragging, onMouseDown };
};

export function useGetState<T>(): () => T {
  return useStore().getState;
}

type ImageLoadPlaceholderProps = React.DetailedHTMLProps<
  React.ImgHTMLAttributes<HTMLImageElement>,
  HTMLImageElement
>;

export const mkImageLoadPlaceholder = (
  placeholder: React.ReactNode,
  props: ImageLoadPlaceholderProps
): React.FC<ImageLoadPlaceholderProps> => {
  const ImageLoadPlaceholder = () => {
    const [loaded, setLoaded] = useState(false);

    return (
      <>
        <img
          style={{ visibility: loaded ? 'visible' : 'hidden' }}
          onLoad={() => setLoaded(true)}
          {...props}
        />
        {!loaded ? placeholder : null}
      </>
    );
  };
  return ImageLoadPlaceholder;
};

export const useContainerSize = () => {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const resizeObserver = useRef<ResizeObserver | null>(null);

  const ref = useCallback((node: HTMLDivElement | null) => {
    if (!node) {
      return;
    }

    if (resizeObserver.current) {
      resizeObserver.current.disconnect();
    }

    resizeObserver.current = new ResizeObserver(entries => {
      setSize(entries[0].contentRect);
    });

    resizeObserver.current.observe(node);
  }, []);

  useEffect(() => () => resizeObserver.current?.disconnect(), []);

  return { ref, size };
};

export function addProps<Props extends Record<string, any>, AddedProps extends Record<string, any>>(
  Component: React.ComponentType<Props>,
  addedProps: AddedProps
): React.FC<Omit<Props, keyof AddedProps>> {
  const AddProps = (props: any) => <Component {...props} {...addedProps} />;
  return AddProps;
}

export function useWritableValue<T>(writable: Writable<T>): T {
  const [value, setValue] = useState(get(writable));
  useEffect(() => writable.subscribe(setValue), [writable]);
  return value;
}

export function useMappedWritableValue<T, D>(writable: Writable<T>, map: (value: T) => D): D {
  const [value, setValue] = useState(map(get(writable)));
  useEffect(() => writable.subscribe(v => setValue(map(v))), [writable, map]);
  return value;
}

export function mkLazyComponent<Props extends Record<string, any>>(
  load: () => Promise<{ default: React.ComponentType<Props> }>,
  LoadingComp: React.ComponentType<Props> = () => <div>Loading...</div>
): React.FC<Props> {
  const LazyComp = React.lazy(load);
  const LazyComponent = (props: Props) => (
    <React.Suspense fallback={<LoadingComp {...props} />}>
      <LazyComp {...(props as any)} />
    </React.Suspense>
  );
  return LazyComponent;
}

/**
 *
 * @returns A unique random string ID that will be static over the life of the component
 */
export const useUniqueId = (): string => {
  const ref = useRef<string>(genRandomStringID());
  return ref.current;
};

interface ANewTabProps extends React.HTMLProps<HTMLAnchorElement> {
  to: string;
  text?: string;
  noreferrer?: boolean;
}

/**
 * Link that opens in a new tab.
 */
export const ANewTab: React.FC<ANewTabProps> = ({
  to,
  children,
  text,
  noreferrer = false,
  ...props
}) => (
  <a href={to} target='_blank' rel={`noopener${noreferrer ? ' noreferrer' : ''}`} {...props}>
    {children || text || ''}
  </a>
);

export function useSvelteStore<T>(store: Readable<T>): T {
  const [value, setValue] = useState(get(store));
  useEffect(() => store.subscribe(setValue), [store]);
  return value;
}
