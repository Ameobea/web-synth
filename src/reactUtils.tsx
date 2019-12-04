import React from 'react';
import ReactDOM from 'react-dom';
import { Store } from 'redux';
import { Provider } from 'react-redux';

interface ContainerRenderHelperArgs<P extends { [key: string]: any } = {}> {
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

/**
 * Higher order function that returns a function that handles rendering the provided `Comp` into the container with the
 * id specified by the argument passed into the generated function.  Useful for implementing `renderSmallView`.
 */
export function mkContainerRenderHelper<P extends { [key: string]: any } = {}>({
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

    const rendered = store ? (
      <Provider store={store}>
        <Comp {...props} />
      </Provider>
    ) : (
      <Comp {...props} />
    );
    ReactDOM.render(rendered, node);

    if (predicate) {
      predicate(domId, node);
    }
  };
}

/**
 * Complement of `mkContainerRenderHelper`.  HOF that tears down the React component rendered into the container
 * pointed to by the id passed into the returned function.
 */
export const mkContainerCleanupHelper = ({}: {
  predicate?: (domId: string, node: HTMLElement) => void;
} = {}) => (domId: string) => {
  const node = document.getElementById(domId);
  if (!node) {
    console.error(`No node with id ${domId} found when trying to clean up small view`);
    return;
  }

  ReactDOM.unmountComponentAtNode(node);
};
