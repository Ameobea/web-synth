import * as PIXI from 'pixi.js';

import { makeDraggable } from 'src/controls/pixiUtils';
import type MIDIEditorUIInstance from 'src/midiEditor/MIDIEditorUIInstance';
import * as conf from './conf';

export class CursorGutter {
  private app: MIDIEditorUIInstance;

  constructor(app: MIDIEditorUIInstance) {
    this.app = app;

    const g = new PIXI.Graphics();
    g.beginFill(conf.CURSOR_GUTTER_COLOR);
    g.drawRect(0, 0, this.app.width - conf.PIANO_KEYBOARD_WIDTH - 10, conf.CURSOR_GUTTER_HEIGHT);
    g.endFill();
    g.interactive = true;
    g.on('pointerdown', (evt: PIXI.InteractionEvent) => {
      if (evt.data.button !== 0) {
        return;
      }

      const xPx = evt.data.getLocalPosition(g).x;
      const xBeats = this.app.view.scrollHorizontalBeats + this.app.pxToBeats(xPx);
      this.app.parentInstance.playbackHandler.setCursorPosBeats(xBeats);
    });
    g.lineStyle(1, conf.LINE_BORDER_COLOR);
    g.moveTo(0.5, 0.5)
      .lineTo(this.app.width - conf.PIANO_KEYBOARD_WIDTH - 10, 0.5)
      .lineTo(this.app.width - conf.PIANO_KEYBOARD_WIDTH - 10, conf.CURSOR_GUTTER_HEIGHT)
      .lineTo(0.5, conf.CURSOR_GUTTER_HEIGHT)
      .lineTo(0.5, 0.5);
    g.x = conf.PIANO_KEYBOARD_WIDTH;
    g.cacheAsBitmap = true;
    this.app.app.stage.addChild(g);
  }
}

export class Cursor {
  private app: MIDIEditorUIInstance;
  private posBeats = 0;
  public graphics: PIXI.Graphics;
  public dragData: PIXI.InteractionData | null = null;

  public handleDrag(newPos: PIXI.Point) {
    const normalizedX = newPos.x - conf.PIANO_KEYBOARD_WIDTH;
    const newPosBeats = Math.max(
      this.app.pxToBeats(normalizedX) + this.app.view.scrollHorizontalBeats,
      0
    );
    const didUpdate = this.app.parentInstance.playbackHandler.setCursorPosBeats(newPosBeats);
    if (!didUpdate) {
      return;
    }
    this.setPosBeats(newPosBeats);
  }

  private buildGraphics(): PIXI.Graphics {
    const g = new PIXI.Graphics();
    g.alpha = 0.99;
    g.lineStyle(1, conf.CURSOR_COLOR, 0.6);
    g.moveTo(conf.CURSOR_CARET_WIDTH / 2 + 0.25, 1);
    g.lineTo(conf.CURSOR_CARET_WIDTH / 2 + 0.25, this.app.height - 10);
    g.lineStyle(0);
    g.beginFill(conf.CURSOR_COLOR, 1);
    g.interactive = true;
    g.cursor = 'pointer';
    g.drawPolygon([
      new PIXI.Point(0, 0),
      new PIXI.Point(conf.CURSOR_CARET_WIDTH, 0),
      new PIXI.Point(conf.CURSOR_CARET_WIDTH / 2, conf.CURSOR_CARET_HEIGHT),
      new PIXI.Point(0, 0),
    ]);
    g.endFill();
    g.cacheAsBitmap = true;

    makeDraggable(g, this, false);

    return g;
  }

  constructor(inst: MIDIEditorUIInstance) {
    this.app = inst;
    this.graphics = this.buildGraphics();
  }

  public setPosBeats(posBeats: number) {
    this.posBeats = posBeats;
    this.handleViewChange();
  }

  public handleViewChange() {
    const normalizedPosBeats = this.posBeats - this.app.view.scrollHorizontalBeats;
    const xPx =
      this.app.beatsToPx(normalizedPosBeats) +
      conf.PIANO_KEYBOARD_WIDTH -
      conf.CURSOR_CARET_WIDTH / 2;
    if (xPx < conf.PIANO_KEYBOARD_WIDTH - conf.CURSOR_CARET_WIDTH / 2 - 1) {
      this.graphics.alpha = 0;
      return;
    }
    this.graphics.alpha = 1;
    this.graphics.x = xPx;
  }
}
