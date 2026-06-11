import React from 'react';
import { createRoot } from 'react-dom/client';

import './Modal.css';
import { mount, unmount, type Component } from 'svelte';

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
  const root = createRoot(modalNode);

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

export function renderSvelteModalWithControls<T, Props extends ModalCompProps<T>>(
  Comp: Component<ModalCompProps<T>>,
  clickBackdropToClose = true,
  extraProps?: Partial<Omit<Props, 'onSubmit' | 'onCancel'>>
): Promise<T> {
  const bodyNode = document.getElementsByTagName('body')[0]!;
  const modalNode = document.createElement('div');
  bodyNode.appendChild(modalNode);
  modalNode.setAttribute('class', 'input-modal');

  let inst: Record<string, any> | null = null;
  const closeModal = () => {
    if (inst) {
      void unmount(inst);
      inst = null;
    }
    bodyNode.removeChild(modalNode);
  };
  if (clickBackdropToClose) {
    modalNode.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.target === modalNode) {
        closeModal();
      }
    });
  }

  // Render the component into the modal and wait for its callback to be triggered
  return new Promise((resolve, reject) => {
    inst = mount(Comp, {
      target: modalNode,
      props: {
        onSubmit: (val: T) => {
          // Unmount the modal and resolve the `Promise`
          closeModal();
          resolve(val);
        },
        onCancel: () => {
          closeModal();
          reject();
        },
        ...(extraProps || {}),
      },
    });
  });
}
