import * as PIXI from 'src/controls/pixi';
import { makeDraggable } from 'src/controls/pixiUtils';
import type MIDIEditorUIInstance from 'src/midiEditor/MIDIEditorUIInstance';
import * as conf from './conf';
import type { FederatedPointerEvent } from '@pixi/events';
import { BookmarkPosBeats } from 'src/eventScheduler';

export class CursorGutter {
  private app: MIDIEditorUIInstance;
  private isDragging = false;
  private graphics: PIXI.Graphics;

  private getPosBeats = (evt: FederatedPointerEvent): number => {
    const xPx = evt.getLocalPosition(this.graphics).x - conf.PIANO_KEYBOARD_WIDTH;
    return this.app.parentInstance.snapBeat(
      Math.max(0, this.app.parentInstance.baseView.scrollHorizontalBeats + this.app.pxToBeats(xPx))
    );
  };

  constructor(app: MIDIEditorUIInstance) {
    this.app = app;

    const g = new PIXI.Graphics();
    g.beginFill(conf.CURSOR_GUTTER_COLOR);
    g.drawRect(0, 0, this.app.width, conf.CURSOR_GUTTER_HEIGHT);
    g.endFill();
    g.interactive = true;

    const handlePointerMove = (evt: FederatedPointerEvent) => {
      if (!this.isDragging) {
        return;
      }

      const xBeats = this.getPosBeats(evt);
      this.app.parentInstance.playbackHandler.setCursorPosBeats(xBeats);
    };

    g.on('pointerdown', (evt: FederatedPointerEvent) => {
      if (evt.button !== 0) {
        return;
      }
      this.isDragging = true;

      const xBeats = this.getPosBeats(evt);
      this.app.parentInstance.playbackHandler.setCursorPosBeats(xBeats);

      this.app.app.stage.on('pointermove', handlePointerMove);
      this.app.addMouseUpCB(() => {
        this.isDragging = false;
        this.app.app.stage.off('pointermove', handlePointerMove);
      });
    }).on('rightclick', evt => {
      const xBeats = this.getPosBeats(evt);
      BookmarkPosBeats.set(xBeats);
      localStorage.bookmarkPosBeats = xBeats;
    });
    g.lineStyle(1, conf.LINE_BORDER_COLOR);
    g.moveTo(this.app.width, conf.CURSOR_GUTTER_HEIGHT).lineTo(0.5, conf.CURSOR_GUTTER_HEIGHT);
    g.zIndex = 400;
    this.graphics = g;
    this.app.app.stage.addChild(g);
    this.app.app.stage.sortableChildren = true;
  }

  public destroy() {
    this.app.app.stage.removeChild(this.graphics);
    this.graphics.destroy();
  }
}

export class Cursor {
  protected app: MIDIEditorUIInstance;
  protected posBeats = 0;
  public graphics: PIXI.Graphics;
  public dragData: FederatedPointerEvent | null = null;
  protected get color(): number {
    return conf.CURSOR_COLOR;
  }

  public handleDrag(newPos: PIXI.Point) {
    const normalizedX = newPos.x - conf.PIANO_KEYBOARD_WIDTH;
    const newPosBeats = Math.max(
      this.app.pxToBeats(normalizedX) + this.app.parentInstance.baseView.scrollHorizontalBeats,
      0
    );
    const didUpdate = this.app.parentInstance.playbackHandler.setCursorPosBeats(newPosBeats);
    if (!didUpdate) {
      return;
    }
    this.setPosBeats(newPosBeats);
  }

  protected buildGraphics(): PIXI.Graphics {
    const g = new PIXI.Graphics();
    g.alpha = 0.99;
    g.lineStyle(1, this.color, 0.6);
    g.moveTo(conf.CURSOR_CARET_WIDTH / 2 + 0.25, 1);
    g.lineTo(conf.CURSOR_CARET_WIDTH / 2 + 0.25, this.app.height);
    g.lineStyle(0);
    g.beginFill(this.color, 1);
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
    g.zIndex = 500;

    makeDraggable(g, this, false);

    return g;
  }

  constructor(inst: MIDIEditorUIInstance, initialPosBeats?: number) {
    this.app = inst;
    this.graphics = this.buildGraphics();
    if (typeof initialPosBeats === 'number') {
      this.setPosBeats(initialPosBeats);
    }
  }

  public setPosBeats(posBeats: number) {
    this.posBeats = posBeats;
    this.handleViewChange();
  }

  public handleViewChange() {
    const normalizedPosBeats =
      this.posBeats - this.app.parentInstance.baseView.scrollHorizontalBeats;
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

  public getPosBeats() {
    return this.posBeats;
  }

  public destroy() {
    this.graphics.destroy();
  }
}

export class LoopCursor extends Cursor {
  protected get color(): number {
    return conf.LOOP_CURSOR_COLOR;
  }

  public handleDrag(newPos: PIXI.Point) {
    if (this.app.parentInstance.playbackHandler.isPlaying) {
      return;
    }

    const normalizedX = newPos.x - conf.PIANO_KEYBOARD_WIDTH;
    const newPosBeats = Math.max(
      this.app.parentInstance.snapBeat(
        this.app.pxToBeats(normalizedX) + this.app.parentInstance.baseView.scrollHorizontalBeats
      ),
      0
    );
    this.app.parentInstance.setLoopPoint(newPosBeats);
  }
}

export class BookmarkCursor extends Cursor {
  protected get color(): number {
    return conf.BOOKMARK_CURSOR_COLOR;
  }

  constructor(inst: MIDIEditorUIInstance, initialPosBeats?: number) {
    super(inst, initialPosBeats);
    this.graphics.on('rightclick', () => {
      BookmarkPosBeats.set(null);
      delete localStorage.bookmarkPosBeats;
    });
  }

  public handleDrag(newPos: PIXI.Point) {
    const normalizedX = newPos.x - conf.PIANO_KEYBOARD_WIDTH;
    const newPosBeats = this.app.parentInstance.snapBeat(
      Math.max(
        this.app.pxToBeats(normalizedX) + this.app.parentInstance.baseView.scrollHorizontalBeats,
        0
      )
    );

    this.setPosBeats(newPosBeats);

    localStorage.bookmarkPosBeats = newPosBeats;
    BookmarkPosBeats.set(newPosBeats);
  }
}
