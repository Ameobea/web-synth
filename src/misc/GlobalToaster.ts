import GlobalToaster from 'src/misc/GlobalToaster.svelte';
import { mkSvelteContainerRenderHelper } from 'src/svelteUtils';
import type { Renderable, ToastOptions } from 'svelte-french-toast';
import { writable } from 'svelte/store';

const CurToast = writable<{
  message: Renderable;
  options?: ToastOptions;
  variant?: 'success' | 'error';
} | null>(null);

(window as any).toast = (message: Renderable, options?: ToastOptions) =>
  void CurToast.set({ message, options });
(window as any).toastSuccess = (message: Renderable, options?: ToastOptions) =>
  void CurToast.set({ message, options, variant: 'success' });
(window as any).toastError = (message: Renderable, options?: ToastOptions) =>
  void CurToast.set({ message, options, variant: 'error' });

export const createGlobalToaster = () => {
  const globalToasterRoot = document.createElement('div');
  globalToasterRoot.id = 'global-toaster-root';
  document.body.appendChild(globalToasterRoot);
  mkSvelteContainerRenderHelper({ Comp: GlobalToaster, getProps: () => ({ curToast: CurToast }) })(
    'global-toaster-root'
  );
};
