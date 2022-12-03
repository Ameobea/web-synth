import { get, type Writable } from 'svelte/store';

import { makeDraggable } from 'src/controls/pixiUtils';
import type { CompressorNodeUIState } from 'src/graphEditor/nodes/CustomAudio/Compressor/CompressorNode';
import * as PIXI from './pixi';

const MARGIN_TOP_PX = 20;
const COMRESSOR_CONTROLS_HEIGHT_PX = 100;
const COMPRESSOR_MARGIN_PX = 140;
const COMPRESSOR_BG_COLOR = 0x141414;

const MIN_VALUE_DB = -80;
const MAX_VALUE_DB = 0;

// SAB Layout:
// 0: low band detected level
// 1: mid band detected level
// 2: high band detected level
// 3: low band envelope level
// 4: mid band envelope level
// 5: high band envelope level

class CompressorControls {
  public container: PIXI.Container;
  private sab: Float32Array | null = null;
  private detectedSABIx: number;
  private envelopeSABIx: number;
  private outputSABIx: number;
  private width: number;
  private threshold: number;
  private thresholdGraphics: PIXI.Graphics;
  private onThresholdChange: (threshold: number) => void;

  public dragData: PIXI.InteractionData | null = null;

  public handleDrag = (newPos: PIXI.Point) => {
    this.thresholdGraphics.x = newPos.x;
    this.threshold = MIN_VALUE_DB + (newPos.x / this.width) * (MAX_VALUE_DB - MIN_VALUE_DB);
    this.onThresholdChange(this.threshold);
  };

  constructor(
    width: number,
    detectedSABIx: number,
    envelopeSABIx: number,
    outputSABIx: number,
    initialThreshold: number,
    onThresholdChange: (newThreshold: number) => void
  ) {
    this.container = new PIXI.Container();
    this.detectedSABIx = detectedSABIx;
    this.envelopeSABIx = envelopeSABIx;
    this.outputSABIx = outputSABIx;
    this.width = width;
    this.threshold = initialThreshold;
    this.onThresholdChange = onThresholdChange;
    const bg = new PIXI.Graphics();
    bg.beginFill(COMPRESSOR_BG_COLOR);
    bg.drawRect(0, 0, width, COMRESSOR_CONTROLS_HEIGHT_PX);
    bg.endFill();
    bg.cacheAsBitmap = true;
    this.container.addChild(bg);

    // White vertical 2px thick tick line to indicate threshold
    const thresholdGraphics = new PIXI.Graphics();
    thresholdGraphics.lineStyle(2, 0xffffff);
    thresholdGraphics.moveTo(0, 0);
    thresholdGraphics.lineTo(0, COMRESSOR_CONTROLS_HEIGHT_PX);
    thresholdGraphics.cacheAsBitmap = true;
    this.container.addChild(thresholdGraphics);
    this.thresholdGraphics = thresholdGraphics;
    this.thresholdGraphics.x =
      (this.width * (this.threshold - MIN_VALUE_DB)) / (MAX_VALUE_DB - MIN_VALUE_DB);

    makeDraggable(thresholdGraphics, this);
  }

  public setSAB(sab: Float32Array) {
    this.sab = sab;
  }

  public render() {
    if (!this.sab) {
      return;
    }

    const detectedLevel = this.sab[this.detectedSABIx];
    const envelopeLevel = this.sab[this.envelopeSABIx];
    const outputLevel = this.sab[this.outputSABIx];

    // green rectangle to indicate detected level
    // red rectangle to indicate envelope level
    // blue rectangle to indicate output level

    const detectedLevelWidth = Math.max(
      0,
      Math.min(1, (detectedLevel - MIN_VALUE_DB) / (MAX_VALUE_DB - MIN_VALUE_DB))
    );
    const envelopeLeveWidth = Math.max(
      0,
      Math.min(1, (envelopeLevel - MIN_VALUE_DB) / (MAX_VALUE_DB - MIN_VALUE_DB))
    );
    const outputLevelWidth = Math.max(
      0,
      Math.min(1, (outputLevel - MIN_VALUE_DB) / (MAX_VALUE_DB - MIN_VALUE_DB))
    );

    const detectedLevelRect = new PIXI.Graphics();
    detectedLevelRect.beginFill(0x00ff00);
    detectedLevelRect.drawRect(0, 0, detectedLevelWidth * this.width, 8);
    detectedLevelRect.endFill();
    detectedLevelRect.cacheAsBitmap = false;

    const envelopeLevelRect = new PIXI.Graphics();
    envelopeLevelRect.beginFill(0xff0000);
    envelopeLevelRect.drawRect(0, 8, envelopeLeveWidth * this.width, 8);
    envelopeLevelRect.endFill();
    envelopeLevelRect.cacheAsBitmap = false;

    const outputLevelRect = new PIXI.Graphics();
    outputLevelRect.beginFill(0x0000ff);
    outputLevelRect.drawRect(0, 16, outputLevelWidth * this.width, 8);
    outputLevelRect.endFill();
    outputLevelRect.cacheAsBitmap = false;

    this.container.removeChildren();
    this.container.addChild(this.thresholdGraphics);
    this.container.addChild(detectedLevelRect);
    this.container.addChild(envelopeLevelRect);
    this.container.addChild(outputLevelRect);
  }
}

export class MultibandCompressorControls {
  private app: PIXI.Application;
  private highBand: CompressorControls;
  private midBand: CompressorControls;
  private lowBand: CompressorControls;

  constructor(canvas: HTMLCanvasElement, store: Writable<CompressorNodeUIState>) {
    const curState = get(store);

    this.app = new PIXI.Application({
      view: canvas,
      width: canvas.width,
      height: canvas.height,
    });
    this.highBand = new CompressorControls(
      canvas.width,
      2,
      5,
      8,
      curState.high.threshold,
      newThreshold => {
        store.update(state => {
          state.high.threshold = newThreshold;
          return state;
        });
      }
    );
    this.highBand.container.position.set(
      0,
      MARGIN_TOP_PX + 2 * (COMRESSOR_CONTROLS_HEIGHT_PX + COMPRESSOR_MARGIN_PX)
    );
    this.app.stage.addChild(this.highBand.container);
    this.midBand = new CompressorControls(
      canvas.width,
      1,
      4,
      7,
      curState.mid.threshold,
      newThreshold => {
        store.update(state => {
          state.mid.threshold = newThreshold;
          return state;
        });
      }
    );
    this.midBand.container.position.set(
      0,
      MARGIN_TOP_PX + COMRESSOR_CONTROLS_HEIGHT_PX + COMPRESSOR_MARGIN_PX
    );
    this.app.stage.addChild(this.midBand.container);
    this.lowBand = new CompressorControls(
      canvas.width,
      0,
      3,
      6,
      curState.low.threshold,
      newThreshold => {
        store.update(state => {
          state.low.threshold = newThreshold;
          return state;
        });
      }
    );
    this.lowBand.container.position.set(0, MARGIN_TOP_PX);
    this.app.stage.addChild(this.lowBand.container);

    if (curState.sab) {
      this.setSAB(curState.sab);
      return;
    }

    const unsubscribe = store.subscribe(state => {
      if (state.sab) {
        this.setSAB(state.sab);
        unsubscribe();
      }
    });
  }

  private setSAB(sab: Float32Array) {
    this.highBand.setSAB(sab);
    this.midBand.setSAB(sab);
    this.lowBand.setSAB(sab);

    this.app.ticker.add(() => this.render());
  }

  private render() {
    this.highBand.render();
    this.midBand.render();
    this.lowBand.render();
  }

  public dispose() {
    this.app.destroy(false, { children: true, texture: true, baseTexture: true });
  }
}
