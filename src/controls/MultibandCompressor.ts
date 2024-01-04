import { get, type Writable } from 'svelte/store';

import { destroyPIXIApp, makeDraggable } from 'src/controls/pixiUtils';
import type {
  CompressorBandState,
  CompressorNodeUIState,
} from 'src/graphEditor/nodes/CustomAudio/Compressor/CompressorNode';
import { delay } from 'src/util';
import * as PIXI from './pixi';
import type { FederatedPointerEvent } from '@pixi/events';

const MARGIN_TOP_PX = 122;
const COMPRESSOR_CONTROLS_HEIGHT_PX = 120;
const COMPRESSOR_MARGIN_PX = 140;
const COMPRESSOR_BG_COLOR = 0x141414;

const MIN_VALUE_DB = -60;
const MAX_VALUE_DB = 4;

// SAB Layout:
// 0: low band detected level
// 1: mid band detected level
// 2: high band detected level
// 3: low band envelope level
// 4: mid band envelope level
// 5: high band envelope level
// 6: low band output level
// 7: mid band output level
// 8: high band output level
// 9: low band applied gain
// 10: mid band applied gain
// 11: high band applied gain

class CompressorControls {
  public container: PIXI.Container;
  private sab: Float32Array | null = null;
  private detectedSABIx: number;
  private envelopeSABIx: number;
  private outputSABIx: number;
  private appliedGainSABIx: number;
  private width: number;
  private bottomThreshold: number;
  private bottomThresholdGraphics: PIXI.Graphics;
  private topThreshold: number;
  private topThresholdGraphics: PIXI.Graphics;
  private onThresholdChange: (bottomThreshold: number, topThreshold: number) => void;

  private bottomDragHandler: {
    dragData: FederatedPointerEvent | null;
    handleDrag: (newPos: PIXI.Point) => void;
  };
  private topDragHandler: {
    dragData: FederatedPointerEvent | null;
    handleDrag: (newPos: PIXI.Point) => void;
  };

  constructor(
    width: number,
    detectedSABIx: number,
    envelopeSABIx: number,
    outputSABIx: number,
    appliedGainSABIx: number,
    initialBottomThreshold: number,
    initialTopThreshold: number,
    onThresholdChange: (newBottomThreshold: number, newTopThreshold: number) => void
  ) {
    this.container = new PIXI.Container();
    this.detectedSABIx = detectedSABIx;
    this.envelopeSABIx = envelopeSABIx;
    this.outputSABIx = outputSABIx;
    this.appliedGainSABIx = appliedGainSABIx;
    this.width = width;
    this.bottomThreshold = initialBottomThreshold;
    this.topThreshold = initialTopThreshold;
    this.onThresholdChange = onThresholdChange;
    const bg = new PIXI.Graphics();
    bg.beginFill(COMPRESSOR_BG_COLOR);
    bg.drawRect(0, 0, width, COMPRESSOR_CONTROLS_HEIGHT_PX);
    bg.endFill();
    bg.cacheAsBitmap = true;
    this.container.addChild(bg);

    this.bottomDragHandler = {
      dragData: null,
      handleDrag: newPos => {
        let newBottomThreshold =
          MIN_VALUE_DB + (newPos.x / this.width) * (MAX_VALUE_DB - MIN_VALUE_DB);
        newBottomThreshold = Math.min(newBottomThreshold, this.topThreshold - 0.5);
        // clamp visual position as well
        this.bottomThresholdGraphics.x =
          (this.width * (newBottomThreshold - MIN_VALUE_DB)) / (MAX_VALUE_DB - MIN_VALUE_DB);
        this.bottomThreshold = newBottomThreshold;
        this.onThresholdChange(newBottomThreshold, this.topThreshold);
      },
    };

    // White vertical 2px thick tick line to indicate threshold
    const bottomThresholdGraphics = new PIXI.Graphics();
    bottomThresholdGraphics.lineStyle(2, 0xffffff);
    bottomThresholdGraphics.moveTo(0, 0);
    bottomThresholdGraphics.lineTo(0, COMPRESSOR_CONTROLS_HEIGHT_PX);
    bottomThresholdGraphics.cacheAsBitmap = true;
    bottomThresholdGraphics.cursor = 'ew-resize';
    this.container.addChild(bottomThresholdGraphics);
    this.bottomThresholdGraphics = bottomThresholdGraphics;
    this.bottomThresholdGraphics.x =
      (this.width * (this.bottomThreshold - MIN_VALUE_DB)) / (MAX_VALUE_DB - MIN_VALUE_DB);

    makeDraggable(bottomThresholdGraphics, this.bottomDragHandler);

    this.topDragHandler = {
      dragData: null,
      handleDrag: newPos => {
        let newTopThreshold =
          MIN_VALUE_DB + (newPos.x / this.width) * (MAX_VALUE_DB - MIN_VALUE_DB);
        newTopThreshold = Math.max(newTopThreshold, this.bottomThreshold + 0.5);
        this.topThreshold = newTopThreshold;
        // clamp visual position as well
        this.topThresholdGraphics.x =
          (this.width * (this.topThreshold - MIN_VALUE_DB)) / (MAX_VALUE_DB - MIN_VALUE_DB);
        this.onThresholdChange(this.bottomThreshold, newTopThreshold);
      },
    };

    // White vertical 2px thick tick line to indicate threshold
    const topThresholdGraphics = new PIXI.Graphics();
    topThresholdGraphics.lineStyle(2, 0xffffff);
    topThresholdGraphics.moveTo(0, 0);
    topThresholdGraphics.lineTo(0, COMPRESSOR_CONTROLS_HEIGHT_PX);
    topThresholdGraphics.cacheAsBitmap = true;
    topThresholdGraphics.cursor = 'ew-resize';
    this.container.addChild(topThresholdGraphics);
    this.topThresholdGraphics = topThresholdGraphics;
    this.topThresholdGraphics.x =
      (this.width * (this.topThreshold - MIN_VALUE_DB)) / (MAX_VALUE_DB - MIN_VALUE_DB);

    makeDraggable(topThresholdGraphics, this.topDragHandler);
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
    const appliedGain = this.sab[this.appliedGainSABIx];

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

    // Display applied gain as either a red bar going to the left from the midpoint or a green bar going to the right from the midpoint.
    //
    // Should display in linear units and have a min of 0 to the left and a max of 5 to the right.
    const appliedGainRect = new PIXI.Graphics();
    if (appliedGain > 1) {
      appliedGainRect.beginFill(0x00ff00);
      // scale applied gain to be between 0 and 1, where 1=0 and 5=1
      const appliedGainWidth = Math.max(0, Math.min(1, appliedGain / 5));
      appliedGainRect.drawRect(
        this.width / 2,
        COMPRESSOR_CONTROLS_HEIGHT_PX - 8,
        appliedGainWidth * (this.width / 2),
        8
      );
    } else if (appliedGain < 1) {
      // draw red rect from the midpoint to the left
      // scale applied gain to be between 0 and 1, where 1=1 and 0=0
      const appliedGainWidth = Math.max(0, Math.min(1, 1 - appliedGain));
      appliedGainRect.beginFill(0xff0000);
      appliedGainRect.drawRect(
        this.width / 2 - appliedGainWidth * (this.width / 2),
        COMPRESSOR_CONTROLS_HEIGHT_PX - 8,
        appliedGainWidth * (this.width / 2),
        8
      );
    }
    appliedGainRect.endFill();
    appliedGainRect.cacheAsBitmap = false;

    this.container.removeChildren();
    this.container.addChild(this.bottomThresholdGraphics);
    this.container.addChild(this.topThresholdGraphics);
    this.container.addChild(detectedLevelRect);
    this.container.addChild(envelopeLevelRect);
    this.container.addChild(outputLevelRect);
    this.container.addChild(appliedGainRect);
  }

  public setState(newState: CompressorBandState) {
    this.bottomThreshold = newState.bottom_threshold;
    this.topThreshold = newState.top_threshold;

    this.bottomThresholdGraphics.x =
      (this.width * (this.bottomThreshold - MIN_VALUE_DB)) / (MAX_VALUE_DB - MIN_VALUE_DB);
    this.topThresholdGraphics.x =
      (this.width * (this.topThreshold - MIN_VALUE_DB)) / (MAX_VALUE_DB - MIN_VALUE_DB);

    this.render();
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
      view: canvas as PIXI.ICanvas,
      width: canvas.width,
      height: canvas.height,
    });
    this.highBand = new CompressorControls(
      canvas.width,
      2,
      5,
      8,
      11,
      curState.high.bottom_threshold,
      curState.high.top_threshold,
      (newBottomThreshold, newTopThreshold) => {
        store.update(state => {
          state.high.bottom_threshold = newBottomThreshold;
          state.high.top_threshold = newTopThreshold;
          return state;
        });
      }
    );
    this.highBand.container.position.set(
      0,
      MARGIN_TOP_PX + 2 * (COMPRESSOR_CONTROLS_HEIGHT_PX + COMPRESSOR_MARGIN_PX)
    );
    this.app.stage.addChild(this.highBand.container);
    this.midBand = new CompressorControls(
      canvas.width,
      1,
      4,
      7,
      10,
      curState.mid.bottom_threshold,
      curState.mid.top_threshold,
      (newBottomThreshold, newTopThreshold) => {
        store.update(state => {
          state.mid.bottom_threshold = newBottomThreshold;
          state.mid.top_threshold = newTopThreshold;
          return state;
        });
      }
    );
    this.midBand.container.position.set(
      0,
      MARGIN_TOP_PX + COMPRESSOR_CONTROLS_HEIGHT_PX + COMPRESSOR_MARGIN_PX
    );
    this.app.stage.addChild(this.midBand.container);
    this.lowBand = new CompressorControls(
      canvas.width,
      0,
      3,
      6,
      9,
      curState.low.bottom_threshold,
      curState.low.top_threshold,
      (newBottomThreshold, newTopThreshold) => {
        store.update(state => {
          state.low.bottom_threshold = newBottomThreshold;
          state.low.top_threshold = newTopThreshold;
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

  private async setSAB(sab: Float32Array) {
    this.highBand.setSAB(sab);
    this.midBand.setSAB(sab);
    this.lowBand.setSAB(sab);

    while (!this.app.ticker) {
      await delay(50);
    }
    this.app.ticker.add(() => this.render());
  }

  private render() {
    this.highBand.render();
    this.midBand.render();
    this.lowBand.render();
  }

  public setState(state: CompressorNodeUIState) {
    this.highBand.setState(state.high);
    this.midBand.setState(state.mid);
    this.lowBand.setState(state.low);
  }

  public dispose() {
    destroyPIXIApp(this.app);
  }
}
