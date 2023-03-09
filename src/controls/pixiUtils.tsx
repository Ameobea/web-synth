import type * as PIXI from 'src/controls/pixi';
import { logError } from 'src/sentry';

export interface DragState {
  dragData: PIXI.InteractionData | null;
  handleDrag: (newPos: PIXI.Point) => void;
}

export const makeDraggable = (g: PIXI.Graphics, parent: DragState, stopPropagation?: boolean) => {
  g.interactive = true;
  g.on('pointerdown', (evt: PIXI.InteractionEvent) => {
    if ((evt.data.originalEvent as any).button !== 0) {
      return;
    }

    parent.dragData = evt.data;
    if (stopPropagation) {
      evt.stopPropagation();
    }
  })
    .on('pointerup', () => {
      parent.dragData = null;
    })
    .on('pointerupoutside', () => {
      parent.dragData = null;
    })
    .on('pointermove', () => {
      if (!parent.dragData) {
        return;
      }

      const newPosition = parent.dragData.getLocalPosition(g.parent);
      parent.handleDrag(newPosition);
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
