import { UnreachableException } from 'ameo-utils';
import numbro from 'numbro';
import * as R from 'ramda';
import React, { useEffect, useRef } from 'react';
import ControlPanel from 'react-control-panel';

import type { ADSRWithOutputRange } from 'src/controls/adsr2/ControlPanelADSR2';
import * as PIXI from 'src/controls/pixi';
import { makeDraggable } from 'src/controls/pixiUtils';
import {
  AdsrLengthMode,
  type Adsr,
  type AdsrStep,
} from 'src/graphEditor/nodes/CustomAudio/FMSynth/FMSynth';
import { mkLinearToLog } from 'src/util';
import {
  getIsVcHidden,
  registerVcHideCb,
  unregisterVcHideCb,
} from 'src/ViewContextManager/VcHideStatusRegistry';
import ConfigureStepControlPanel from './ConfigureStepControlPanel.svelte';

const dpr = window.devicePixelRatio ?? 1;

const SAMPLE_RATE = 44_100;
const BACKGROUND_COLOR = 0x131313;
const RAMP_LINE_COLOR = 0x43f79d;
const RAMP_LINE_WIDTH = Math.min(1.4 * dpr, 2);
const INTERPOLATED_SEGMENT_LENGTH_PX = 2 * dpr;
const STEP_HANDLE_WIDTH = Math.min(4 * dpr, 6);
const RAMP_HANDLE_COLOR = 0x0077ff;
const PHASE_MARKER_COLOR = 0x73e6cf;
const LOOP_DRAG_BAR_COLOR = 0xffd608;
const RELEASE_DRAG_BAR_COLOR = 0x5818d9;
const SCALE_MARKING_LINE_COLOR = 0xeeeeee;
const ctx = new AudioContext();

PIXI.settings.ROUND_PIXELS = true;

interface ADSR2Sprites {
  rampCurves: RampCurve[];
}

interface StepHandleConfiguratorCtx {
  inst: ConfigureStepControlPanel;
}

PIXI.utils.skipHello();

/**
 * Controls the properties of a ramp curve.  Can be dragged, but must be bounded by the marks that define
 * the start and stop of the ramp it belongs to.
 */
class RampHandle {
  private dragData: PIXI.InteractionData | null = null;
  private startStep: AdsrStep;
  private endStep: AdsrStep;
  private inst: ADSR2Instance;
  private parentRamp: RampCurve;
  private graphics!: PIXI.Graphics;
  private renderedRegion: RenderedRegion;

  private computeInitialPos(): PIXI.Point {
    const rampStartPx = computeTransformedXPosition(
      this.renderedRegion,
      this.inst.width,
      this.startStep.x
    );
    const rampEndPx = computeTransformedXPosition(
      this.renderedRegion,
      this.inst.width,
      this.endStep.x
    );
    const rampWidthPx = rampEndPx - rampStartPx;
    const rampHeightPx = (this.endStep.y - this.startStep.y) * this.inst.height;

    switch (this.endStep.ramper.type) {
      case 'exponential': {
        const x = 0.5;
        const y = Math.pow(x, this.endStep.ramper.exponent);
        return new PIXI.Point(
          rampStartPx + x * rampWidthPx,
          this.inst.height - (this.startStep.y * this.inst.height + y * rampHeightPx)
        );
      }
      default: {
        throw new UnreachableException(
          'Ramp type does not support modifying curve: ' + this.endStep.ramper.type
        );
      }
    }
  }

  private computeNewEndPoint(pos: PIXI.Point) {
    // handle inverted direction of y axis compared to what we want
    pos.y = this.inst.height - pos.y;

    switch (this.endStep.ramper.type) {
      case 'exponential': {
        const x = R.clamp(
          0.01,
          0.99,
          (computeReverseTransformedXPosition(this.renderedRegion, this.inst.width, pos.x) -
            this.startStep.x) /
            (this.endStep.x - this.startStep.x)
        );
        const y = R.clamp(
          0.01,
          0.99,
          (pos.y / this.inst.height - this.startStep.y) / (this.endStep.y - this.startStep.y)
        );
        // Actually using some math I learned in school for maybe the first time...
        // Law of logarithms:
        // log(x^n) = n*log(x)
        // y = x^n -> log(y) = n * log(x) -> n = log(y)/log(x)
        let exponent = Math.log(y) / Math.log(x);
        if (Number.isNaN(exponent)) {
          exponent = 1;
        }
        this.endStep.ramper.exponent = exponent;
        break;
      }
      default: {
        throw new UnreachableException(
          'Ramp type does not support modifying curve: ' + this.endStep.ramper.type
        );
      }
    }
  }

  private handleDrag(newPos: PIXI.Point) {
    // Always constrain drags to the area defined by the marks
    newPos.x = R.clamp(
      computeTransformedXPosition(this.renderedRegion, this.inst.width, this.startStep.x),
      computeTransformedXPosition(this.renderedRegion, this.inst.width, this.endStep.x),
      newPos.x
    );
    newPos.y = R.clamp(
      Math.min((1 - this.startStep.y) * this.inst.height, (1 - this.endStep.y) * this.inst.height),
      Math.max((1 - this.startStep.y) * this.inst.height, (1 - this.endStep.y) * this.inst.height),
      newPos.y
    );
    this.graphics.position.set(newPos.x, newPos.y);

    this.computeNewEndPoint(newPos);

    this.parentRamp.reRenderRampCurve(this.startStep, this.endStep);

    this.inst.onUpdated();
  }

  private render() {
    const g = new PIXI.Graphics();
    g.lineStyle(0);
    g.beginFill(RAMP_HANDLE_COLOR);
    g.drawCircle(0, 0, STEP_HANDLE_WIDTH);
    g.endFill();
    g.position.copyFrom(this.computeInitialPos());
    g.zIndex = 2;
    g.interactive = true;
    g.cursor = 'pointer';

    g.on('pointerdown', (evt: any) => {
      this.dragData = evt.data;
    })
      .on('pointerup', () => {
        this.dragData = null;
      })
      .on('pointerupoutside', () => {
        this.dragData = null;
      })
      .on('pointermove', () => {
        if (!this.dragData) {
          return;
        }

        const newPosition = this.dragData.getLocalPosition(this.graphics.parent);
        this.handleDrag(newPosition);
      });

    this.graphics = g;
    this.inst.vizContainer.addChild(g);
  }

  constructor(
    inst: ADSR2Instance,
    parentRamp: RampCurve,
    startStep: AdsrStep,
    endStep: AdsrStep,
    renderedRegion: RenderedRegion
  ) {
    this.renderedRegion = renderedRegion;
    this.inst = inst;
    this.startStep = startStep;
    this.endStep = endStep;
    this.parentRamp = parentRamp;
    this.render();
  }

  public setRenderedRegion(renderedRegion: RenderedRegion) {
    this.renderedRegion = renderedRegion;
    this.graphics.position.copyFrom(this.computeInitialPos());
  }

  public destroy() {
    this.inst.vizContainer.removeChild(this.graphics);
    this.graphics.destroy();
  }
}

/**
 * Entity representing the ramp curve between two `AdsrkMark`s.  Contains PIXI graphics for both the curve itself
 * as well as optionally a handle entity for modifying the curve.
 */
class RampCurve {
  private curve: PIXI.Graphics;
  private handle: RampHandle | null;
  private inst: ADSR2Instance;
  private renderedRegion: RenderedRegion;
  private steps: [AdsrStep, AdsrStep];

  constructor(
    inst: ADSR2Instance,
    startStep: AdsrStep,
    endStep: AdsrStep,
    renderedRegion: RenderedRegion
  ) {
    this.steps = [startStep, endStep];
    this.inst = inst;
    this.renderedRegion = renderedRegion;
    this.curve = this.renderRampCurve(startStep, endStep);
    this.handle = this.buildRampHandle(startStep, endStep);
  }

  private buildRampHandle(startStep: AdsrStep, endStep: AdsrStep) {
    switch (endStep.ramper.type) {
      case 'exponential': {
        return new RampHandle(this.inst, this, startStep, endStep, this.renderedRegion);
      }
      default: {
        return null;
      }
    }
  }

  private computeRampCurve(step1: AdsrStep, step2: AdsrStep): { x: number; y: number }[] {
    const step1PosXPx = computeTransformedXPosition(this.renderedRegion, this.inst.width, step1.x);
    const step2PosXPx = computeTransformedXPosition(this.renderedRegion, this.inst.width, step2.x);

    switch (step2.ramper.type) {
      case 'linear': {
        return [
          { x: step1PosXPx, y: (1 - step1.y) * this.inst.height },
          { x: step2PosXPx, y: (1 - step2.y) * this.inst.height },
        ];
      }
      case 'exponential': {
        const widthPx = step2PosXPx - step1PosXPx;
        const heightPx = (1 - step2.y - (1 - step1.y)) * this.inst.height;
        const isFullyOffScreen =
          (step1PosXPx > this.inst.width && step2PosXPx > this.inst.width) ||
          (step1PosXPx < 0 && step2PosXPx < 0);
        const pointCount = isFullyOffScreen
          ? 2
          : Math.ceil(widthPx / INTERPOLATED_SEGMENT_LENGTH_PX) + 1;

        const pts = [];
        for (let i = 0; i <= pointCount; i++) {
          const pct = i / pointCount;
          const x = step1.x + pct * (step2.x - step1.x);
          const y = Math.pow(pct, step2.ramper.exponent);

          if (i !== 0 && i !== pointCount - 1) {
            const isOnScreen =
              x > this.renderedRegion.start - 0.01 && x < this.renderedRegion.end + 0.01;
            if (!isOnScreen) {
              continue;
            }
          }

          pts.push({
            x: step1PosXPx + pct * widthPx,
            y: (1 - step1.y) * this.inst.height + y * heightPx,
          });
        }
        return pts;
      }
      case 'instant': {
        return [
          { x: step1PosXPx, y: (1 - step1.y) * this.inst.height },
          { x: step2PosXPx, y: (1 - step1.y) * this.inst.height },
          { x: step2PosXPx, y: (1 - step2.y) * this.inst.height },
        ];
      }
    }
  }

  public renderRampCurve(step1: AdsrStep, step2: AdsrStep): PIXI.Graphics {
    const graphics = new PIXI.Graphics();
    graphics.lineStyle(RAMP_LINE_WIDTH, RAMP_LINE_COLOR, 1, 0.5, false);
    const [start, ...points] = this.computeRampCurve(step1, step2);
    graphics.moveTo(start.x, start.y);
    points.forEach(({ x, y }) => graphics.lineTo(x, y));
    this.inst.vizContainer.addChild(graphics);
    return graphics;
  }

  public reRenderRampCurve(startStep: AdsrStep, endStep: AdsrStep) {
    this.steps = [startStep, endStep];
    if (this.curve) {
      this.inst.vizContainer.removeChild(this.curve);
      this.curve.destroy();
    }
    this.curve = this.renderRampCurve(startStep, endStep);
  }

  public setRenderedRegion(renderedRegion: RenderedRegion) {
    this.renderedRegion = renderedRegion;
    this.reRenderRampCurve(this.steps[0], this.steps[1]);
    this.handle?.setRenderedRegion(renderedRegion);
  }

  public destroy() {
    this.inst.vizContainer.removeChild(this.curve);
    this.handle?.destroy();
  }
}

class StepHandle {
  private inst: ADSR2Instance;
  private graphics!: PIXI.Graphics;
  private dragData: PIXI.InteractionData | null = null;
  public step: AdsrStep;
  private renderedRegion: RenderedRegion;
  private disableSnapToEnd: boolean;

  public handlePointerMoveInner(xPx: number, yPx: number) {
    // Clamp first and last points to the start and end of the envelope
    const index = this.inst.steps.findIndex(s => s === this);
    if (index === 0) {
      xPx = 0;
    } else if (index === this.inst.steps.length - 1) {
      if (this.disableSnapToEnd) {
        xPx = R.clamp(0.001, Infinity, xPx);
      } else {
        xPx = this.inst.width;
      }
    } else {
      xPx = R.clamp(0.001, this.inst.width - 0.0001, xPx);
    }
    yPx = R.clamp(0, this.inst.height - 0.0001, yPx);

    this.step.x = computeReverseTransformedXPosition(this.renderedRegion, this.inst.width, xPx);
    this.step.y = 1 - yPx / this.inst.height;

    this.graphics.position.set(xPx, yPx);
    this.inst.sortAndUpdateMarks(index);
    this.inst.onUpdated();
    this.inst.setFrozenOutputValue?.(this.step.y);
  }

  private handlePointerMove() {
    if (!this.dragData) {
      return;
    }

    const newPosition = this.dragData.getLocalPosition(this.graphics.parent);
    this.handlePointerMoveInner(newPosition.x, newPosition.y);
  }

  private render() {
    const g = new PIXI.Graphics();
    g.lineStyle(0);
    g.beginFill(RAMP_LINE_COLOR);
    g.drawCircle(0, 0, STEP_HANDLE_WIDTH);
    g.endFill();
    g.zIndex = 2;

    // Drag handling
    g.buttonMode = true;
    g.interactive = true;
    g.on('pointerdown', (evt: any) => {
      const originalEvent: PointerEvent = evt.data.originalEvent;
      if (originalEvent.ctrlKey) {
        this.inst.openStepHandleConfigurator(this, originalEvent);
        return;
      }

      this.dragData = evt.data;
    })
      .on('pointerup', () => {
        this.dragData = null;
      })
      .on('pointerupoutside', () => {
        this.dragData = null;
      })
      .on('pointermove', () => this.handlePointerMove())
      .on('rightdown', (evt: any) => {
        const data: PIXI.InteractionData = evt.data;
        data.originalEvent.preventDefault();
        data.originalEvent.stopPropagation();
        this.delete();
      });

    this.inst.vizContainer.addChild(g);
    g.x = computeTransformedXPosition(this.renderedRegion, this.inst.width, this.step.x);
    g.y = (1 - this.step.y) * this.inst.height;
    this.graphics = g;
  }

  private delete() {
    const ourIndex = this.inst.steps.findIndex(o => o === this);
    if (ourIndex === 0 || ourIndex === this.inst.steps.length - 1) {
      return;
    }
    this.inst.steps.splice(ourIndex, 1);
    this.destroy();
    this.inst.sortAndUpdateMarks();
  }

  constructor(
    inst: ADSR2Instance,
    step: AdsrStep,
    renderedRegion: RenderedRegion,
    disableSnapToEnd: boolean
  ) {
    this.disableSnapToEnd = disableSnapToEnd;
    this.inst = inst;
    this.step = step;
    this.renderedRegion = renderedRegion;
    this.render();
  }

  public setRenderedRegion(renderedRegion: RenderedRegion) {
    this.renderedRegion = renderedRegion;
    this.graphics.x = computeTransformedXPosition(renderedRegion, this.inst.width, this.step.x);
    // TODO: Cull offscreen handles
  }

  public destroy() {
    this.inst.vizContainer.removeChild(this.graphics);
    this.graphics.destroy();
  }
}

/**
 * Bar attached to the top of the ADSR that can be dragged from side to side.
 */
class DragBar {
  private inst: ADSR2Instance;
  private g!: PIXI.Graphics;
  public dragData: PIXI.InteractionData | null = null;
  private onDrag: (newVal: number) => void;

  constructor(
    inst: ADSR2Instance,
    color: number,
    initialPos: number,
    onDrag: (newVal: number) => void
  ) {
    this.inst = inst;
    this.onDrag = onDrag;

    this.renderInitial(color, initialPos);
  }

  private renderInitial(color: number, initialPos: number) {
    const g = new PIXI.Graphics();
    g.beginFill(color);
    g.drawCircle(0, 4, STEP_HANDLE_WIDTH);
    g.lineStyle(2, color, 1, 0.5, false);
    g.lineTo(0, this.inst.height + 2);
    g.endFill();

    makeDraggable(g, this);

    g.x = LEFT_GUTTER_WIDTH_PX + initialPos * this.inst.width;
    g.y = TOP_GUTTER_WIDTH_PX - 4;
    this.inst.app?.stage.addChild(g);
    this.g = g;
  }

  public handleDrag(newPosition: PIXI.Point) {
    // We're a child of the root container since we need to display outside of the main ADSR space, so
    // we have to manually constrain our x position to keep it inside of that range
    const x = R.clamp(LEFT_GUTTER_WIDTH_PX, LEFT_GUTTER_WIDTH_PX + this.inst.width, newPosition.x);
    this.g.x = x;
    const newVal = R.clamp(0, 1, (x - LEFT_GUTTER_WIDTH_PX) / this.inst.width);
    this.onDrag(newVal);
  }

  public setPos(newPos: number) {
    this.g.x = LEFT_GUTTER_WIDTH_PX + this.inst.width * newPos;
  }

  public destroy() {
    this.dragData = null;
    this.g.destroy();
  }
}

/**
 * Renders lines on the background of the ADSR to show the scale of both the x and y axises
 */
class ScaleMarkings {
  private inst: ADSR2Instance;
  private g!: PIXI.Graphics;
  private lenMs: number;
  private logScale = false;
  private outputRange: readonly [number, number];
  private texts: PIXI.Text[] = [];

  constructor(inst: ADSR2Instance, lenMs: number, outputRange: readonly [number, number]) {
    this.inst = inst;
    this.lenMs = lenMs;
    this.outputRange = outputRange;

    this.render();
  }

  public update(lenMs: number, outputRange: readonly [number, number], logScale: boolean) {
    if (
      lenMs === this.lenMs &&
      R.equals(outputRange, this.outputRange) &&
      this.logScale === logScale
    ) {
      return;
    }

    this.outputRange = outputRange;
    this.logScale = logScale;

    this.render();
  }

  public destroy() {
    this.g?.destroy();
    this.texts.forEach(text => text.destroy());
    this.texts = [];
  }

  private computeHorizontalAxisLineCount() {
    return Math.round(this.inst.height / 70);
  }

  private render() {
    this.destroy();

    const g = new PIXI.Graphics();
    g.lineStyle(0.5, SCALE_MARKING_LINE_COLOR, 0.5, 0.5, false);
    g.moveTo(this.inst.width / 2, 0);
    g.lineTo(this.inst.width / 2, this.inst.height);

    const createText = (scaledY: number) => {
      const formatted = numbro(scaledY).format({
        thousandSeparated: false,
        lowPrecision: true,
        average: true,
        totalLength: 4,
        trimMantissa: true,
      });
      const text = new PIXI.Text(formatted, {
        fontSize: 8.5 * dpr,
        fontFamily: 'PT Sans',
        fill: 0xfcfcfc,
      });
      text.x = Math.min(2 * dpr, 5);
      this.inst.app?.stage.addChild(text);
      return text;
    };

    const text = createText(this.outputRange[1]);
    text.y = TOP_GUTTER_WIDTH_PX - 2 * dpr;
    this.texts.push(text);

    const horizontalAxisLineCount = this.computeHorizontalAxisLineCount();
    const horizontalAxisLineSpacing = this.inst.height / (horizontalAxisLineCount + 1);
    const linearToLog = mkLinearToLog(0.001, 1, 1);
    const scale = this.outputRange[1] - this.outputRange[0];
    const shift = this.outputRange[0];
    for (let i = 0; i < horizontalAxisLineCount + 1; i++) {
      if (i !== horizontalAxisLineCount) {
        g.moveTo(1, (i + 1) * horizontalAxisLineSpacing);
        g.lineTo(this.inst.width - 2, (i + 1) * horizontalAxisLineSpacing);
      }

      const yPct = (horizontalAxisLineCount + 1 - (i + 1)) / (horizontalAxisLineCount + 1);
      const scaledY = this.logScale
        ? linearToLog(yPct * 100) * scale + shift
        : yPct * scale + shift;

      const text = createText(scaledY);
      text.y = TOP_GUTTER_WIDTH_PX + (i + 1) * horizontalAxisLineSpacing - 12;

      this.texts.push(text);
    }

    this.g = g;
    this.inst.vizContainer.addChildAt(g, 2);
  }
}

/**
 * A handle containing a piece of memory shared between this thread and the audio thread used to obtain real-time info
 * about the ADSR instance as it is running.
 */
export interface AudioThreadData {
  /**
   * The shared memory buffer between this thread and the audio thread.
   */
  buffer?: Float32Array;
  /**
   * The index of `buffer` at which the envelope's current phase is stored and updated
   */
  phaseIndex: number;
  debugName?: string;
}

/**
 * The normalized [0, 1] start and end of the region of the envelope to be rendered
 */
export interface RenderedRegion {
  /**
   * The normalized [0, 1] start of the region of the envelope to be rendered
   */
  start: number;
  /**
   * The normalized [0, 1] end of the region of the envelope to be rendered
   */
  end: number;
}

export const LEFT_GUTTER_WIDTH_PX = 27 * dpr;
const RIGHT_GUTTER_WIDTH_PX = 7 * dpr;
const TOP_GUTTER_WIDTH_PX = 10 * dpr;
const BOTTOM_GUTTER_WIDTH_PX = 10 * dpr;

/**
 * Given the normalized [0, 1] X position of an element to be rendered on the ADSR, returns the X position
 * in pixels given the current `renderedRegion` and the ADSR's width.
 */
const computeTransformedXPosition = (
  { start, end }: RenderedRegion,
  widthPx: number,
  x: number
): number => {
  return (x - start) * (1 / (end - start)) * widthPx;
};

/**
 * Given the X position in pixels of an element to be rendered on the ADSR, returns the normalized [0, 1] X position
 * given the current `renderedRegion` and the ADSR's width.
 */
const computeReverseTransformedXPosition = (
  { start, end }: RenderedRegion,
  widthPx: number,
  xPx: number
): number => {
  return start + (xPx / widthPx) * (end - start);
};

export class ADSR2Instance {
  /**
   * This only time this will be uninitialized is when WebGL isn't supported by the browser (probably in CI)
   */
  public app: PIXI.Application | undefined;
  private lengthMs = 1000;
  private outputRange: readonly [number, number] = [0, 1];
  private logScale = false;
  private lengthMode: AdsrLengthMode | undefined;
  public steps!: StepHandle[];
  private renderedRegion: RenderedRegion = { start: 0, end: 1 };
  public sprites!: ADSR2Sprites;
  private loopPoint: number | null = null;
  private loopDragBar: DragBar | null = null;
  private releasePoint!: number;
  private releaseDragBar: DragBar | null = null;
  private onChange: (newState: ADSRWithOutputRange) => void;
  private lastClick: { time: number; pos: PIXI.Point } | null = null;
  private ctx: AudioContext;
  /**
   * If enabled, the envelope will not have a specific end point.  Adding more points on the end will
   * extend the envelope.  This is used in the CV outputs for the MIDI editor currently.
   */
  private infiniteMode: boolean;
  private disablePhaseVisualization = false;
  private audioThreadData: AudioThreadData;
  private scaleMarkings!: ScaleMarkings;
  private vcId?: string;
  private stepHandleConfigurator: StepHandleConfiguratorCtx | null = null;
  /**
   * Container into which the ADSR curve, handles, phase viz, and other pieces are rendered
   */
  public vizContainer: PIXI.Container;
  public setFrozenOutputValue: ((frozenOutputValue: number) => void) | undefined;

  /**
   * Returns the width of the canvas in pixels minus the horizontal gutters
   */
  public get width() {
    if (!this.app) {
      return 0;
    }
    return this.app.renderer.width - LEFT_GUTTER_WIDTH_PX - RIGHT_GUTTER_WIDTH_PX;
  }
  /**
   * Returns the height of the canvas in pixels minus the vertical gutters
   */
  public get height() {
    if (!this.app) {
      return 0;
    }
    return this.app.renderer.height - TOP_GUTTER_WIDTH_PX - BOTTOM_GUTTER_WIDTH_PX;
  }

  public onUpdated() {
    this.onChange(this.serialize());
    this.scaleMarkings.update(this.lengthMs, this.outputRange, this.logScale);
  }

  private setSteps(newSteps: AdsrStep[]) {
    this.steps.forEach(step => step.destroy());
    this.steps = newSteps.map(
      step => new StepHandle(this, R.clone(step), this.renderedRegion, this.infiniteMode)
    );
    this.sortAndUpdateMarks();
  }

  public setRenderedRegion(renderedRegion: RenderedRegion) {
    this.renderedRegion = renderedRegion;
    this.steps.forEach(step => step.setRenderedRegion(renderedRegion));
    this.sprites.rampCurves.forEach(curve => curve.setRenderedRegion(renderedRegion));

    this.maybeAddOrUpdateEndVirtualRampCurve();
  }

  private maybeAddOrUpdateEndVirtualRampCurve() {
    // If the end of the rendered region is greater than the X value of the final step, then we need to render
    // a "virtual" ramp curve to the end of the rendered region from the final step.
    const finalStep = this.steps[this.steps.length - 1];
    if (finalStep.step.x < this.renderedRegion.end) {
      const virtualEndStep: AdsrStep = {
        x: this.renderedRegion.end,
        y: finalStep.step.y,
        ramper: { type: 'linear' },
      };
      const newVirtualRampCurve = new RampCurve(
        this,
        finalStep.step,
        virtualEndStep,
        this.renderedRegion
      );

      if (this.sprites.rampCurves.length === this.steps.length - 1) {
        this.sprites.rampCurves.push(newVirtualRampCurve);
      } else {
        const virtualRampCurve = this.sprites.rampCurves[this.sprites.rampCurves.length - 1];
        virtualRampCurve.destroy();
        this.sprites.rampCurves[this.sprites.rampCurves.length - 1] = newVirtualRampCurve;
      }
    }
  }

  public update(
    state: Adsr,
    onChange: (newState: ADSRWithOutputRange) => void,
    outputRange: readonly [number, number]
  ) {
    this.onChange = onChange;
    if (isNaN(state.lenSamples)) {
      console.warn(`\`state.lenSamples\` is ${state.lenSamples}; setting to 1000...`);
      state.lenSamples = 1000;
    }

    const newLengthMs = (state.lenSamples / SAMPLE_RATE) * 1000;
    this.lengthMs = newLengthMs;

    if (!R.equals(this.steps.map(R.prop('step')), state.steps)) {
      this.setSteps(state.steps);
    }

    if (this.loopPoint !== state.loopPoint) {
      this.loopPoint = state.loopPoint;
      if (R.isNil(this.loopPoint) && this.loopDragBar) {
        this.loopDragBar.destroy();
        this.loopDragBar = null;
      } else if (!R.isNil(this.loopPoint)) {
        if (this.loopDragBar) {
          this.loopDragBar.setPos(this.loopPoint);
        } else {
          this.loopDragBar = this.buildLoopDragBar();
        }
      }
    }

    if (this.releasePoint !== state.releasePoint) {
      this.releasePoint = state.releasePoint;
      this.releaseDragBar?.setPos(this.releasePoint);
    }

    this.outputRange = [...outputRange];
    this.logScale = state.logScale ?? false;
    this.lengthMode = state.lengthMode;
    this.audioThreadData = state.audioThreadData;
    this.scaleMarkings.update(this.lengthMs, this.outputRange, this.logScale);
  }

  public setLengthMs(newLengthMs: number) {
    if (this.lengthMs === newLengthMs) {
      return;
    }

    this.lengthMs = newLengthMs;
    this.onUpdated();
  }

  public sortAndUpdateMarks(updatedMarkIx?: number) {
    this.steps = R.sortBy(step => step.step.x, this.steps);

    while (this.sprites.rampCurves.length < this.steps.length - 1) {
      this.sprites.rampCurves.push(null as any); // this will get reconciled instantly
    }
    while (this.sprites.rampCurves.length > this.steps.length - (this.infiniteMode ? 0 : 1)) {
      if (!R.isNil(updatedMarkIx)) {
        throw new UnreachableException(
          "Can't have an updated mark index when there are more ramps than expected"
        );
      }
      this.sprites.rampCurves.pop()!.destroy();
    }

    this.sprites.rampCurves.forEach((_i, curveIx) => {
      // If the updated mark doesn't touch this ramp curve, we can leave it be
      if (!R.isNil(updatedMarkIx) && curveIx !== updatedMarkIx && curveIx !== updatedMarkIx - 1) {
        return;
      }

      this.sprites.rampCurves[curveIx]?.destroy();
      const startStep = this.steps[curveIx].step;
      let endStep = this.steps[curveIx + 1]?.step;
      if (this.infiniteMode && !endStep) {
        // Create a virtual end step at the same Y value as the start step and an X value at the end
        // of current rendered region
        endStep = { x: this.renderedRegion.end, y: startStep.y, ramper: { type: 'linear' } };
      }

      this.sprites.rampCurves[curveIx] = new RampCurve(
        this,
        startStep,
        endStep,
        this.renderedRegion
      );
    });
  }

  /**
   * Builds the PIXI entity used to indicate the phase of the ADSR
   */
  private buildPhaseMarker() {
    const g = new PIXI.Graphics();
    g.lineStyle(0, 0, 0);
    g.moveTo(0, 0);
    g.zIndex = -1;
    g.beginFill(PHASE_MARKER_COLOR, 0.22);
    g.drawRect(0, 0, this.width, this.height);
    g.endFill();
    g.x = -this.width;
    this.vizContainer.addChild(g);
    return g;
  }

  constructor(
    width: number,
    height: number,
    canvas: HTMLCanvasElement,
    onChange: (newState: Adsr) => void,
    ctx: AudioContext,
    initialState: Adsr,
    outputRange: readonly [number, number],
    vcId?: string,
    debugName?: string,
    infiniteMode?: boolean,
    disablePhaseVisualization?: boolean,
    setFrozenOutputValue?: (frozenOutputValue: number) => void
  ) {
    if (!debugName) {
      console.trace('No debug name provided for ADSR');
    }
    try {
      this.app = new PIXI.Application({
        antialias: true,
        autoDensity: true,
        view: canvas,
        height: height * dpr,
        width: width * dpr,
        backgroundColor: BACKGROUND_COLOR,
      });
    } catch (err) {
      console.error('Failed to initialize PixiJS applicationl; WebGL not supported?');
    }

    if (vcId) {
      this.vcId = vcId;
      this.registerVcHideCb();
    }

    this.setFrozenOutputValue = setFrozenOutputValue;
    this.infiniteMode = infiniteMode ?? false;
    this.disablePhaseVisualization = disablePhaseVisualization ?? false;
    this.audioThreadData = initialState.audioThreadData;
    this.onChange = onChange;
    this.ctx = ctx;
    this.outputRange = [...outputRange];
    this.logScale = initialState.logScale ?? false;
    this.lengthMode = initialState.lengthMode;

    this.vizContainer = new PIXI.Container();
    this.vizContainer.x = LEFT_GUTTER_WIDTH_PX;
    this.vizContainer.y = TOP_GUTTER_WIDTH_PX;
    // This means that z-indices actually work
    // this.vizContainer.sortableChildren = true;
    // basically `overflow: hidden`, I think
    this.vizContainer.mask = new PIXI.Graphics()
      .beginFill(0xffffff)
      .drawRect(LEFT_GUTTER_WIDTH_PX, TOP_GUTTER_WIDTH_PX, this.width - 1, this.height - 1)
      .endFill();

    this.initBackgroundClickHandler();

    if (initialState && !(initialState as any).attack) {
      this.deserialize(initialState);
    } else {
      this.steps = [
        { x: 0, y: 0.5, ramper: { type: 'linear' as const } },
        { x: 0.5, y: 0.8, ramper: { type: 'exponential' as const, exponent: 1.5 } },
        { x: 1, y: 0.5, ramper: { type: 'exponential' as const, exponent: 1.1 } },
      ].map(step => new StepHandle(this, step, this.renderedRegion, this.infiniteMode));
      this.releasePoint = 0.8;
    }

    this.renderInitial();
  }

  public setSize(width: number, height: number) {
    this.app?.renderer.resize(width * dpr, height * dpr);
  }

  private addStep(pos: PIXI.Point) {
    const step = new StepHandle(
      this,
      {
        x: computeReverseTransformedXPosition(this.renderedRegion, this.width, pos.x),
        y: 1 - pos.y / this.height,
        ramper: { type: 'exponential' as const, exponent: 0.1 },
      },
      this.renderedRegion,
      this.infiniteMode
    );
    this.steps.push(step);
    this.sortAndUpdateMarks();
    this.onChange(this.serialize());

    this.maybeAddOrUpdateEndVirtualRampCurve();
  }

  private initBackgroundClickHandler() {
    const bg = new PIXI.Graphics();
    bg.lineStyle(1, 0x888888);
    bg.beginFill(0x000000);
    bg.drawRect(0, 0, this.width, this.height);
    bg.endFill();
    bg.x = 0;
    bg.y = 0;
    bg.width = this.width;
    bg.height = this.height;

    bg.zIndex = -2;
    bg.interactive = true;
    bg.on('click', (evt: any) => {
      const now = this.ctx.currentTime;
      const data: PIXI.InteractionData = evt.data;
      const pos = data.getLocalPosition(bg.parent);

      if (!this.lastClick || this.lastClick.pos.x !== pos.x || this.lastClick.pos.y !== pos.y) {
        this.lastClick = { time: now, pos };
        return;
      }

      const isInDoubleClickTimeRange = now - this.lastClick.time;
      if (!isInDoubleClickTimeRange) {
        this.lastClick = { time: now, pos };
        return;
      }

      // We've got a bona-fide double click
      this.lastClick = null;
      this.addStep(pos);
    });
    this.vizContainer.addChild(bg);
  }

  private buildLoopDragBar() {
    if (R.isNil(this.loopPoint)) {
      throw new UnreachableException();
    }

    return new DragBar(this, LOOP_DRAG_BAR_COLOR, this.loopPoint, (newLoopPos: number) => {
      if (newLoopPos < 0 || newLoopPos > 1) {
        throw new UnreachableException();
      }

      // constrain loop point to be before the release point
      newLoopPos = R.clamp(0, this.releasePoint, newLoopPos);
      this.loopDragBar?.setPos(newLoopPos);

      this.loopPoint = newLoopPos;
      this.onUpdated();
    });
  }

  private renderInitial() {
    const rampCurves = [];
    for (let i = 0; i < this.steps.length - 1; i++) {
      rampCurves.push(
        new RampCurve(this, this.steps[i].step, this.steps[i + 1].step, this.renderedRegion)
      );
    }

    this.app?.stage.addChild(this.vizContainer);

    this.sprites = { rampCurves };

    const phaseMarker = this.disablePhaseVisualization ? null : this.buildPhaseMarker();

    if (!R.isNil(this.loopPoint)) {
      this.loopDragBar = this.buildLoopDragBar();
    }

    if (!this.infiniteMode) {
      this.releaseDragBar = new DragBar(
        this,
        RELEASE_DRAG_BAR_COLOR,
        this.releasePoint,
        (newReleasePos: number) => {
          if (newReleasePos < 0 || newReleasePos > 1) {
            throw new UnreachableException();
          }

          // release has to be after the loop point, if there is one
          if (!R.isNil(this.loopPoint)) {
            newReleasePos = R.clamp(this.loopPoint, 1, newReleasePos);
            this.releaseDragBar?.setPos(newReleasePos);
          }

          this.releasePoint = newReleasePos;
          this.onUpdated();
        }
      );
    }

    this.scaleMarkings = new ScaleMarkings(this, this.lengthMs, this.outputRange);

    if (!phaseMarker) {
      return;
    }
    this.app?.ticker.add(() => {
      if (!this.audioThreadData?.buffer) {
        return;
      }
      const phase = this.audioThreadData.buffer[this.audioThreadData.phaseIndex];
      phaseMarker.x = -this.width + phase * this.width;
    });
  }

  private closeStepHandleConfigurator() {
    if (!this.stepHandleConfigurator) {
      return;
    }

    this.stepHandleConfigurator.inst.$destroy();
    this.stepHandleConfigurator = null;
  }

  public openStepHandleConfigurator(step: StepHandle, evt: PointerEvent) {
    this.closeStepHandleConfigurator();

    const parent = this.app?.renderer.view.parentElement;
    if (!parent) {
      console.error('Could not find parent element of renderer');
      return;
    }

    const { x, y } = evt;
    const onSubmit = (newStep: AdsrStep) => {
      const xPx = computeTransformedXPosition(
        this.renderedRegion,
        this.width,
        this.infiniteMode ? newStep.x * this.renderedRegion.end : newStep.x
      );
      const yPx = (1 - newStep.y) * this.height;
      step.handlePointerMoveInner(xPx, yPx);
      this.closeStepHandleConfigurator();
    };

    this.stepHandleConfigurator = {
      inst: new ConfigureStepControlPanel({
        props: {
          top: y - 50,
          left: x,
          length: {
            type: {
              [AdsrLengthMode.Beats]: 'beats' as const,
              [AdsrLengthMode.Samples]: 'ms' as const,
            }[this.lengthMode ?? AdsrLengthMode.Samples],
            value: this.infiniteMode ? this.renderedRegion.end : this.lengthMs,
          },
          onCancel: () => this.closeStepHandleConfigurator(),
          onSubmit,
          outputRange: this.outputRange ?? [0, 1],
          step: this.infiniteMode
            ? { ...step.step, x: step.step.x / this.renderedRegion.end }
            : step.step,
        },
        target: parent,
      }),
    };
  }

  private deserialize(state: Adsr) {
    state.lenSamples = state.lenSamples ?? SAMPLE_RATE;
    this.steps = state.steps.map(
      step => new StepHandle(this, R.clone(step), this.renderedRegion, this.infiniteMode)
    );
    this.lengthMs = (state.lenSamples / SAMPLE_RATE) * 1000;
    this.loopPoint = state.loopPoint;
    this.releasePoint = state.releasePoint;
  }

  private registerVcHideCb = () => {
    if (!this.vcId) {
      return;
    }

    registerVcHideCb(this.vcId, this.onHiddenStatusChanged);
    // If the VC we belong to is currently hidden, then stop ticker immediately
    const ourVcIsHidden = getIsVcHidden(this.vcId);
    this.onHiddenStatusChanged(ourVcIsHidden);
  };

  public onHiddenStatusChanged = (isHidden: boolean) => {
    if (isHidden) {
      this.app?.ticker.stop();
    } else {
      this.app?.ticker.start();
    }
  };

  public serialize(): ADSRWithOutputRange {
    return {
      steps: this.steps.map(R.prop('step')),
      lenSamples: (this.lengthMs / 1000) * SAMPLE_RATE,
      loopPoint: this.loopPoint,
      releasePoint: this.releasePoint,
      audioThreadData: this.audioThreadData!,
      outputRange: this.outputRange,
      logScale: this.logScale,
      lengthMode: this.lengthMode,
    };
  }

  public destroy() {
    this.app?.destroy(false, { children: true });
    if (this.vcId) {
      unregisterVcHideCb(this.vcId, this.onHiddenStatusChanged);
    }
  }
}

interface ADSR2Props {
  width?: number;
  height?: number;
  initialState: ADSRWithOutputRange;
  onChange: (newState: ADSRWithOutputRange) => void;
  vcId?: string;
  debugName?: string;
  disableControlPanel?: boolean;
  instanceCb?: (instance: ADSR2Instance) => void;
  enableInfiniteMode?: boolean;
  disablePhaseVisualization?: boolean;
  setFrozenOutputValue?: (frozenOutputValue: number) => void;
}

const ADSR2_SETTINGS = [{ type: 'checkbox', label: 'loop' }];

export const buildDefaultADSR2Envelope = (audioThreadData: AudioThreadData): Adsr => ({
  steps: [
    { x: 0, y: 0.2, ramper: { type: 'exponential', exponent: 0.5 } },
    { x: 0.5, y: 0.8, ramper: { type: 'exponential', exponent: 0.5 } },
    { x: 1, y: 0.2, ramper: { type: 'exponential', exponent: 0.5 } },
  ],
  lenSamples: SAMPLE_RATE / 4,
  loopPoint: 0,
  releasePoint: 0.7,
  audioThreadData,
  logScale: true,
});

const ADSR2: React.FC<ADSR2Props> = ({
  width = 600,
  height = 480,
  initialState,
  onChange,
  vcId,
  debugName,
  disableControlPanel = false,
  instanceCb,
  enableInfiniteMode,
  disablePhaseVisualization,
  setFrozenOutputValue,
}) => {
  const lastSize = useRef({ width, height });
  const instance = useRef<ADSR2Instance | null>(null);
  const [outputRangeStart, outputRangeEnd] = initialState.outputRange;

  useEffect(() => {
    if (!instance.current || !instance.current.app?.view) {
      return;
    }
    if (lastSize.current.width === width && lastSize.current.height === height) {
      return;
    }
    lastSize.current = { width, height };

    instance.current.setSize(width, height);
  }, [width, height]);

  useEffect(() => {
    if (!instance.current || !initialState) {
      return;
    }

    instance.current.update(initialState, onChange, [outputRangeStart, outputRangeEnd]);
  }, [initialState, outputRangeEnd, outputRangeStart, onChange]);

  return (
    <div>
      {disableControlPanel ? null : (
        <ControlPanel
          style={{ width: 140 }}
          settings={ADSR2_SETTINGS}
          state={{ loop: !R.isNil(initialState.loopPoint) }}
          onChange={(key: string, val: any) => {
            switch (key) {
              case 'loop': {
                onChange({ ...initialState, loopPoint: val ? 0 : null });
                break;
              }
              default: {
                console.error('Unhandled key in ADSR2 settings: ', key);
              }
            }
          }}
        />
      )}
      <canvas
        onContextMenu={evt => evt.preventDefault()}
        onMouseDown={evt => {
          evt.stopPropagation();
          evt.preventDefault();
        }}
        height={height}
        width={width}
        style={{ minHeight: height, minWidth: width, maxHeight: height, maxWidth: width }}
        ref={canvas => {
          if (!canvas || instance.current) {
            return;
          }

          instance.current = new ADSR2Instance(
            width,
            height,
            canvas,
            onChange,
            ctx,
            initialState,
            [outputRangeStart, outputRangeEnd],
            vcId,
            debugName,
            enableInfiniteMode,
            disablePhaseVisualization,
            setFrozenOutputValue
          );
          instanceCb?.(instance.current);
        }}
      />
    </div>
  );
};

export default ADSR2;
