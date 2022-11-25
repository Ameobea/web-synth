import type { Writable } from 'svelte/store';

import type { CompressorNodeUIState } from 'src/graphEditor/nodes/CustomAudio/Compressor/CompressorNode';
import * as PIXI from './pixi';

const MARGIN_TOP_PX = 20;
const COMRESSOR_CONTROLS_HEIGHT_PX = 100;
const COMPRESSOR_MARGIN_PX = 140;
const COMPRESSOR_BG_COLOR = 0x141414;

class CompressorControls {
  public container: PIXI.Container;

  constructor(width: number) {
    this.container = new PIXI.Container();
    const bg = new PIXI.Graphics();
    bg.beginFill(COMPRESSOR_BG_COLOR);
    bg.drawRect(0, 0, width, COMRESSOR_CONTROLS_HEIGHT_PX);
    bg.endFill();
    bg.cacheAsBitmap = true;
    this.container.addChild(bg);
  }
}

export class MultibandCompressorControls {
  private canvas: HTMLCanvasElement;
  private app: PIXI.Application;
  private highBand: CompressorControls;
  private midBand: CompressorControls;
  private lowBand: CompressorControls;

  constructor(canvas: HTMLCanvasElement, store: Writable<CompressorNodeUIState>) {
    this.canvas = canvas;
    this.app = new PIXI.Application({
      view: canvas,
      width: canvas.width,
      height: canvas.height,
    });
    this.highBand = new CompressorControls(canvas.width);
    this.highBand.container.position.set(0, MARGIN_TOP_PX);
    this.app.stage.addChild(this.highBand.container);
    this.midBand = new CompressorControls(canvas.width);
    this.midBand.container.position.set(
      0,
      MARGIN_TOP_PX + COMRESSOR_CONTROLS_HEIGHT_PX + COMPRESSOR_MARGIN_PX
    );
    this.app.stage.addChild(this.midBand.container);
    this.lowBand = new CompressorControls(canvas.width);
    this.lowBand.container.position.set(
      0,
      MARGIN_TOP_PX + 2 * (COMRESSOR_CONTROLS_HEIGHT_PX + COMPRESSOR_MARGIN_PX)
    );
    this.app.stage.addChild(this.lowBand.container);
  }

  public dispose() {
    this.app.destroy(false, { children: true, texture: true, baseTexture: true });
  }
}
