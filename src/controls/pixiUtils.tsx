import type { FederatedPointerEvent } from '@pixi/events';
import type * as PIXI from 'src/controls/pixi';
import { logError } from 'src/sentry';

export interface DragState {
  dragData: FederatedPointerEvent | null;
  handleDrag: (newPos: PIXI.Point) => void;
}

export const makeDraggable = (g: PIXI.Graphics, parent: DragState, stopPropagation?: boolean) => {
  g.interactive = true;

  const pointerMoveCb = () => {
    if (!parent.dragData) {
      return;
    }

    const newPosition = parent.dragData.getLocalPosition(g.parent);
    parent.handleDrag(newPosition);
  };

  g.on('pointerdown', (evt: FederatedPointerEvent) => {
    if ((evt.nativeEvent as PointerEvent).button !== 0) {
      return;
    }

    document.addEventListener('pointermove', pointerMoveCb);

    parent.dragData = evt;
    if (stopPropagation) {
      evt.stopPropagation();
    }
  })
    .on('pointerup', () => {
      parent.dragData = null;
      document.removeEventListener('pointermove', pointerMoveCb);
    })
    .on('pointerupoutside', () => {
      parent.dragData = null;
      document.removeEventListener('pointermove', pointerMoveCb);
    });
};

/**
 * Properly destroys the PIXI application, including the WebGL context which apparently gets leaked during the normal destroy process.
 */
export const destroyPIXIApp = (
  app: PIXI.Application,
  destroyParams: { children?: boolean; texture?: boolean; baseTexture?: boolean } = {
    children: true,
    texture: true,
    baseTexture: true,
  }
) => {
  try {
    ((app.renderer as PIXI.Renderer).context as any).gl
      .getExtension('WEBGL_lose_context')
      ?.loseContext();
  } catch (err) {
    logError('Error destroying PIXI app WebGL ctx', err);
  }
  app.destroy(false, destroyParams);
};
