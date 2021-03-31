import type * as PIXI from 'pixi.js';

export interface DragState {
  dragData: PIXI.InteractionData | null;
  handleDrag: (newPos: PIXI.Point) => void;
}

export const makeDraggable = (g: PIXI.Graphics, parent: DragState) => {
  g.buttonMode = true;
  g.interactive = true;
  g.on('pointerdown', (evt: any) => {
    parent.dragData = evt.data;
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
