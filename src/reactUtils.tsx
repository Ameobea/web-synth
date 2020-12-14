import React from 'react';
import ReactDOM from 'react-dom';
import { Store } from 'redux';
import { Provider } from 'react-redux';
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

    const rendered = store ? (
      <Provider store={store}>
        <Comp {...props} />
      </Provider>
    ) : (
      <Comp {...props} />
    );
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
  // If true, the DOM element will not be deleted and
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
    console.error(`Unable to find DOM element with vcId=${vcId} id=${elemID}; can't hide.`);
    return;
  }

  elem.style.display = display;
};
