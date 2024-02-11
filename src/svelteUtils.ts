import React, { type JSXElementConstructor, type ReactElement, type RefObject } from 'react';
import type { Unsubscribe as ReduxUnsubscribe, Store } from 'redux';
import { getState, store, type ReduxStore } from 'src/redux';
import { onDestroy, type SvelteComponent } from 'svelte';
import { writable, type Writable } from 'svelte/store';

import type { Subscriber, Unsubscriber, Updater } from 'svelte/store';

const RenderedSvelteComponentsByDomID = new Map<string, SvelteComponent>();

type MkSvelteContainerRenderHelperArgs<Props extends Record<string, any>> = {
  Comp: typeof SvelteComponent<Props>;
  getProps: () => Props;
  predicate?: (comp: SvelteComponent) => void;
};

export function mkSvelteContainerRenderHelper<Props extends Record<string, any | never>>({
  Comp,
  getProps,
  predicate,
}: MkSvelteContainerRenderHelperArgs<Props>) {
  return (domID: string) => {
    const node = document.getElementById(domID);
    if (!node) {
      console.error(`No node with id ${domID} found when trying to render svelte container`);
      return;
    }

    const props = getProps();

    const BuiltComp = new Comp({ target: node, props });
    RenderedSvelteComponentsByDomID.set(domID, BuiltComp);

    predicate?.(BuiltComp);
  };
}

interface MkSvelteContainerCleanupHelperArgs {
  predicate?: (domID: string, node: HTMLElement) => void;
  /**
   * If `true`, the DOM element will not be deleted.  If `false` or not provided, it will be deleted.
   */
  preserveRoot?: boolean;
}

export const mkSvelteContainerCleanupHelper =
  (args: MkSvelteContainerCleanupHelperArgs = {}) =>
  (domID: string) => {
    const BuiltComp = RenderedSvelteComponentsByDomID.get(domID);
    if (!BuiltComp) {
      console.error(`No built svelte component found with domID=${domID} when cleaning up`);
    } else {
      BuiltComp.$destroy();
    }

    const node = document.getElementById(domID);
    if (!args.preserveRoot) {
      node?.remove();
    }

    if (args.predicate) {
      if (node) {
        args.predicate?.(domID, node);
      } else {
        console.error(
          `Node with id=${domID} not found after successfully unmounting Svelte component; did it perhaps delete the node like we expected it not to?`
        );
      }
    }
  };

/////////////////////////////////////////////////////////////////////////////
//
// The following is adapted from the real Svelte `writable` implementation:
// https://github.com/sveltejs/svelte/blob/master/src/runtime/store/index.ts
//
/////////////////////////////////////////////////////////////////////////////

/** Cleanup logic callback. */
type Invalidator<T> = (value?: T) => void;

/** Pair of subscriber and invalidator. */
type SubscribeInvalidateTuple<T> = [Subscriber<T>, Invalidator<T>];

const noop = () => {
  // noop
};

export function buildSvelteReduxStoreBridge<State, Slice>(
  reduxStore: Store<State>,
  selector: (state: State) => Slice,
  dispatchUpdateAction: (newSlice: Slice) => void
): Writable<Slice> {
  const subscribers: Set<SubscribeInvalidateTuple<Slice>> = new Set();

  let reduxUnsubscribe: ReduxUnsubscribe | null = null;
  const getValue = () => selector(reduxStore.getState());
  let lastSeenSlice: Slice | null = null;
  const onReduxChanged = () => {
    if (subscribers.size === 0) {
      return;
    }

    const newSlice = getValue();
    if (lastSeenSlice === newSlice) {
      return;
    }
    lastSeenSlice = newSlice;

    for (const [subscriber, invalidate] of subscribers) {
      invalidate();
      // Svelte `writable` has some queueing logic here I don't fully understand
      subscriber(newSlice);
    }
  };
  const maybeReduxSubscribe = () => {
    if (reduxUnsubscribe) {
      // already subscribed
      return;
    }

    reduxUnsubscribe = reduxStore.subscribe(onReduxChanged);
  };

  const set = (newVal: Slice) => {
    const val = lastSeenSlice;
    if (val !== newVal) {
      dispatchUpdateAction(newVal);
    }
  };

  const update = (fn: Updater<Slice>) => set(fn(lastSeenSlice ?? getValue()));

  const subscribe = (
    run: Subscriber<Slice>,
    invalidate: Invalidator<Slice> = noop
  ): Unsubscriber => {
    const subscriber: SubscribeInvalidateTuple<Slice> = [run, invalidate];
    subscribers.add(subscriber);
    run(lastSeenSlice ?? getValue());

    maybeReduxSubscribe();

    return () => {
      subscribers.delete(subscriber);
      if (subscribers.size === 0) {
        // No more subscribers; unsub from Redux store to avoid memory leaks or whatever
        if (reduxUnsubscribe) {
          reduxUnsubscribe();
        } else {
          console.error('No `reduxUnsubscribe` set but we had a Svelte subscription');
        }
        reduxUnsubscribe = null;
      }
    };
  };

  return { set, update, subscribe };
}

/**
 * Subscribes to a Redux store using the provided `selector` and returns the result as a Svelte store.
 *
 * Automatically unsubscribes from the Redux store when the Svelte component is destroyed.
 *
 * NOTE: The provided `selector` must remain static.
 */
export function svelteStoreFromRedux<Slice>(
  selector: (state: ReduxStore) => Slice
): Writable<Slice> {
  let lastSlice = selector(getState());
  const svelteStore = writable(lastSlice);

  const unsub = store.subscribe(() => {
    const slice = selector(getState());
    if (slice === lastSlice) {
      return;
    }
    lastSlice = slice;

    svelteStore.set(slice);
  });

  onDestroy(() => void unsub());

  return svelteStore;
}

export type SveltePropTypesOf<Comp> =
  Comp extends SvelteComponent<infer Props>
    ? Props
    : // handle it being the class itself
      Comp extends new (args: {
          target: Element;
          props: infer Props;
        }) => SvelteComponent<infer Props>
      ? Props
      : never;

/**
 * Creates a React component that renders the provided Svelte component.
 *
 * Adapted from: https://github.com/Rich-Harris/react-svelte/blob/master/index.js
 */
export function mkSvelteComponentShim<Props extends Record<string, any>>(
  Comp: typeof SvelteComponent<Props>
) {
  class SvelteComponentShim extends React.Component<Props> {
    private instance: SvelteComponent<Props> | null = null;
    private container: RefObject<ReactElement<Record<string, never>>>;
    private div: ReactElement<{
      ref: RefObject<ReactElement<Record<string, never>, string | JSXElementConstructor<any>>>;
    }>;

    constructor(props: Props) {
      super(props);

      this.container = React.createRef();
      this.div = React.createElement('div', { ref: this.container });
    }

    componentDidMount() {
      this.instance = new Comp({
        target: this.container.current! as any,
        props: this.props,
      });
    }

    componentDidUpdate() {
      this.instance!.$set(this.props);
    }

    componentWillUnmount() {
      this.instance!.$destroy();
    }

    render() {
      return this.div;
    }
  }

  return SvelteComponentShim;
}
