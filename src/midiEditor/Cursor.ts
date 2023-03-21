import * as PIXI from 'src/controls/pixi';
import { makeDraggable } from 'src/controls/pixiUtils';
import type MIDIEditorUIInstance from 'src/midiEditor/MIDIEditorUIInstance';
import * as conf from './conf';

export class CursorGutter {
  private app: MIDIEditorUIInstance;
  private isDragging = false;
  private graphics: PIXI.Graphics;

  constructor(app: MIDIEditorUIInstance) {
    this.app = app;

    const g = new PIXI.Graphics();
    g.beginFill(conf.CURSOR_GUTTER_COLOR);
    g.drawRect(-conf.PIANO_KEYBOARD_WIDTH + 0.5, 0, this.app.width, conf.CURSOR_GUTTER_HEIGHT);
    g.endFill();
    g.interactive = true;
    g.on('pointerdown', (evt: PIXI.InteractionEvent) => {
      if (evt.data.button !== 0) {
        return;
      }
      this.isDragging = true;

      const xPx = evt.data.getLocalPosition(g).x;
      const xBeats = this.app.snapBeat(
        this.app.parentInstance.baseView.scrollHorizontalBeats + this.app.pxToBeats(xPx)
      );
      this.app.parentInstance.playbackHandler.setCursorPosBeats(xBeats);

      this.app.addMouseUpCB(() => {
        this.isDragging = false;
      });
    }).on('pointermove', (evt: PIXI.InteractionEvent) => {
      if (!this.isDragging) {
        return;
      }

      const xPx = evt.data.getLocalPosition(g).x;
      const xBeats = this.app.snapBeat(
        Math.max(
          0,
          this.app.parentInstance.baseView.scrollHorizontalBeats + this.app.pxToBeats(xPx)
        )
      );
      this.app.parentInstance.playbackHandler.setCursorPosBeats(xBeats);
    });
    g.lineStyle(1, conf.LINE_BORDER_COLOR);
    g.moveTo(this.app.width - conf.PIANO_KEYBOARD_WIDTH, conf.CURSOR_GUTTER_HEIGHT).lineTo(
      0.5,
      conf.CURSOR_GUTTER_HEIGHT
    );
    g.x = conf.PIANO_KEYBOARD_WIDTH;
    g.cacheAsBitmap = true;
    this.graphics = g;
    this.app.app.stage.addChild(g);
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
  public dragData: PIXI.InteractionData | null = null;
  protected color = conf.CURSOR_COLOR;

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
  protected color = conf.LOOP_CURSOR_COLOR;

  constructor(inst: MIDIEditorUIInstance, loopPoint: number) {
    super(inst);
    this.graphics.destroy();
    this.graphics = this.buildGraphics();
    this.setPosBeats(loopPoint);
  }

  public handleDrag(newPos: PIXI.Point) {
    if (this.app.parentInstance.playbackHandler.isPlaying) {
      return;
    }

    const normalizedX = newPos.x - conf.PIANO_KEYBOARD_WIDTH;
    const newPosBeats = Math.max(
      this.app.snapBeat(
        this.app.pxToBeats(normalizedX) + this.app.parentInstance.baseView.scrollHorizontalBeats
      ),
      0
    );
    const didUpdate = this.app.parentInstance.playbackHandler.setLoopPoint(newPosBeats);
    if (!didUpdate) {
      return;
    }
    this.setPosBeats(newPosBeats);
  }
}
