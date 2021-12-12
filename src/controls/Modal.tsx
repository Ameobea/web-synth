import React from 'react';
import * as ReactDOM from 'react-dom';

import './Modal.scss';

export interface ModalCompProps<T> {
  onSubmit: (val: T) => void;
  onCancel?: () => void;
}

/**
 * Creates a transitive modal that takes over the current page and renders the provided component
 * into a modal.  Once the callback passed to the component is called, the modal will be torn down
 * and the returned value will be passed back to the caller.
 */
export function renderModalWithControls<T>(
  Comp: React.ComponentType<ModalCompProps<T>>,
  clickBackdropToClose = true
): Promise<T> {
  const bodyNode = document.getElementsByTagName('body')[0]!;
  const modalNode = document.createElement('div');
  bodyNode.appendChild(modalNode);
  modalNode.setAttribute('class', 'input-modal');

  const unmount = () => {
    root.unmount();
    bodyNode.removeChild(modalNode);
  };
  if (clickBackdropToClose) {
    modalNode.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.target === modalNode) {
        unmount();
      }
    });
  }
  const root = ReactDOM.createRoot(modalNode);

  // Render the component into the modal and wait for its callback to be triggered
  return new Promise((resolve, reject) => {
    root.render(
      <Comp
        onSubmit={val => {
          // Unmount the modal and resolve the `Promise`
          unmount();
          resolve(val);
        }}
        onCancel={() => {
          unmount();
          reject();
        }}
      />
    );
  });
}
