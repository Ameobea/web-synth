import * as PIXI from 'pixi.js';

import type MIDIEditorUIInstance from 'src/midiEditor/MIDIEditorUIInstance';
import { midiNumberToNoteName } from 'src/midiUtils';
import * as conf from './conf';

const ActiveNoteMarker = new PIXI.Graphics()
  .beginFill(conf.NOTE_SELECTED_COLOR, 0.8)
  .drawRect(0.5, -0.5, conf.PIANO_KEYBOARD_WIDTH - 0.5, conf.LINE_HEIGHT - 0.5);

export default class PianoKeys {
  private app: MIDIEditorUIInstance;
  private container: PIXI.Container;
  private keysLayer: PIXI.Graphics;
  private labelLayer: PIXI.Graphics;
  private playingNoteMarkersByLineIx: Map<number, PIXI.Graphics> = new Map();
  public dragData: PIXI.InteractionData | null = null;

  private drawKey(lineIx: number, g: PIXI.Graphics) {
    const baseY = lineIx * conf.LINE_HEIGHT;
    const noteName = midiNumberToNoteName(this.app.lines.length - lineIx);
    const isBlackKey = noteName.includes('b') || noteName.includes('#');

    g.beginFill(isBlackKey ? conf.BLACK_NOTE_COLOR : conf.WHITE_NOTE_COLOR);
    g.drawRect(0, baseY, conf.PIANO_KEYBOARD_WIDTH, conf.LINE_HEIGHT);
    g.endFill();

    // draw border
    g.lineStyle(1, conf.LINE_BORDER_COLOR)
      .moveTo(0.5, baseY)
      .lineTo(conf.PIANO_KEYBOARD_WIDTH, baseY)
      .lineTo(conf.PIANO_KEYBOARD_WIDTH, baseY + conf.LINE_HEIGHT)
      .lineTo(0.5, baseY + conf.LINE_HEIGHT)
      .lineTo(0.5, baseY);
  }

  private drawLabel(lineIx: number, g: PIXI.Graphics) {
    const baseY = lineIx * conf.LINE_HEIGHT;
    const noteName = midiNumberToNoteName(this.app.lines.length - lineIx);
    const isBlackKey = noteName.includes('b') || noteName.includes('#');

    const text = new PIXI.Text(noteName, {
      fontFamily: 'PT Sans',
      fontSize: 13,
      fill: isBlackKey ? conf.WHITE_NOTE_COLOR : conf.BLACK_NOTE_COLOR,
    });
    text.x = 4;
    text.y = baseY;
    g.addChild(text);
  }

  private buildKeysLayer(): PIXI.Graphics {
    const g = new PIXI.Graphics();

    this.app.lines.forEach((_line, lineIx) => this.drawKey(lineIx, g));

    g.cacheAsBitmap = true;
    return g;
  }

  private computeLineIx(yPx: number) {
    return Math.floor(
      (yPx + this.app.view.scrollVerticalPx - conf.CURSOR_GUTTER_HEIGHT) / conf.LINE_HEIGHT
    );
  }

  private buildLabelsLayer(): PIXI.Graphics {
    const g = new PIXI.Graphics();

    this.app.lines.forEach((_line, lineIx) => this.drawLabel(lineIx, g));

    g.cacheAsBitmap = true;
    g.zIndex = 2;
    return g;
  }

  constructor(app: MIDIEditorUIInstance) {
    this.app = app;
    this.keysLayer = this.buildKeysLayer();
    this.labelLayer = this.buildLabelsLayer();
    this.container = new PIXI.Container();
    this.container.sortableChildren = true;
    this.container.mask = new PIXI.Graphics()
      .beginFill(0xff3300)
      .drawRect(
        0,
        conf.CURSOR_GUTTER_HEIGHT,
        conf.PIANO_KEYBOARD_WIDTH,
        this.app.height - conf.CURSOR_GUTTER_HEIGHT - 10
      )
      .endFill();
    this.container.addChild(this.keysLayer);
    this.container.addChild(this.labelLayer);
    this.app.app.stage.addChild(this.container);
    this.handleViewChange();

    let downLineIx: number | null = null;

    this.container.interactive = true;
    this.container
      .on('pointerdown', (evt: PIXI.InteractionEvent) => {
        if (evt.data.button !== 0) {
          return;
        }
        console.log('pointerdown');

        const y = evt.data.getLocalPosition(this.container).y;
        downLineIx = this.computeLineIx(y);
        this.app.gate(downLineIx);

        this.app.addMouseUpCB(() => {
          if (downLineIx !== null) {
            this.app.ungate(downLineIx);
          }
          downLineIx = null;
        });
      })
      .on('pointermove', (evt: PIXI.InteractionEvent) => {
        if (downLineIx === null) {
          return;
        }

        const y = evt.data.getLocalPosition(this.container).y;
        const newDownLineIx = this.computeLineIx(y);
        if (newDownLineIx === downLineIx) {
          return;
        }
        this.app.ungate(downLineIx);
        this.app.gate(newDownLineIx);
        downLineIx = newDownLineIx;
      });
  }

  public handleViewChange() {
    const y = -this.app.view.scrollVerticalPx + conf.CURSOR_GUTTER_HEIGHT + 0.5;
    this.keysLayer.y = y;
    this.labelLayer.y = y;

    for (const [lineIx, g] of this.playingNoteMarkersByLineIx.entries()) {
      g.y =
        -this.app.view.scrollVerticalPx +
        conf.LINE_HEIGHT * lineIx +
        conf.CURSOR_GUTTER_HEIGHT +
        0.5;
    }
  }

  public setNotePlaying(lineIx: number, isPlaying: boolean) {
    const existingGraphics = this.playingNoteMarkersByLineIx.get(lineIx);
    if (!!existingGraphics === isPlaying) {
      return;
    }

    if (isPlaying) {
      const graphics = ActiveNoteMarker.clone();
      graphics.y =
        -this.app.view.scrollVerticalPx +
        conf.LINE_HEIGHT * lineIx +
        conf.CURSOR_GUTTER_HEIGHT +
        0.5;
      graphics.zIndex = 1;
      this.container.addChild(graphics);
      this.playingNoteMarkersByLineIx.set(lineIx, graphics);
    } else {
      this.playingNoteMarkersByLineIx.delete(lineIx);
      this.container.removeChild(existingGraphics!);
      existingGraphics!.destroy();
    }
  }
}
