import type { SvelteComponent } from 'svelte';

const RenderedSvelteComponentsByDomID = new Map<string, SvelteComponent>();

type MkSvelteContainerRenderHelperArgs = {
  Comp: typeof SvelteComponent;
  getProps: () => Record<string, any>;
};

export function mkSvelteContainerRenderHelper({
  Comp,
  getProps,
}: MkSvelteContainerRenderHelperArgs) {
  return (domID: string) => {
    const node = document.getElementById(domID);
    if (!node) {
      console.error(`No node with id ${domID} found when trying to render svelte container`);
      return;
    }

    const props = getProps();

    const BuiltComp = new Comp({ target: node, props });
    RenderedSvelteComponentsByDomID.set(domID, BuiltComp);
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
