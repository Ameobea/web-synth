import React, { useEffect, useRef } from 'react';
import * as PIXI from 'pixi.js';
import * as R from 'ramda';
import { UnreachableException } from 'ameo-utils';

import { Adsr, AdsrStep } from 'src/graphEditor/nodes/CustomAudio/FMSynth/FMSynth';

const SAMPLE_RATE = 44_100;
const BACKGROUND_COLOR = 0x131313;
const RAMP_LINE_COLOR = 0x43f79d;
const RAMP_LINE_WIDTH = 2.4;
const INTERPOLATED_SEGMENT_LENGTH_PX = 0.8;
const STEP_HANDLE_WIDTH = 4.5;
const RAMP_HANDLE_COLOR = 0x0077ff;
const PHASE_MARKER_COLOR = 0xf7e045;
const ctx = new AudioContext();

PIXI.settings.ROUND_PIXELS = true;

interface ADSR2Sprites {
  rampCurves: RampCurve[];
}

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

  private computeInitialPos(): PIXI.Point {
    const rampStartPx = this.startStep.x * this.inst.width;
    const rampWidthPx = (this.endStep.x - this.startStep.x) * this.inst.width;
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
          (pos.x / this.inst.width - this.startStep.x) / (this.endStep.x - this.startStep.x)
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
      this.startStep.x * this.inst.width,
      this.endStep.x * this.inst.width,
      newPos.x
    );
    newPos.y = R.clamp(
      Math.min((1 - this.startStep.y) * this.inst.height, (1 - this.endStep.y) * this.inst.height),
      Math.max((1 - this.startStep.y) * this.inst.height, (1 - this.endStep.y) * this.inst.height),
      newPos.y
    );
    this.graphics.position = newPos;

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
    g.position = this.computeInitialPos();
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

  constructor(inst: ADSR2Instance, parentRamp: RampCurve, startStep: AdsrStep, endStep: AdsrStep) {
    this.inst = inst;
    this.startStep = startStep;
    this.endStep = endStep;
    this.parentRamp = parentRamp;
    this.render();
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

  constructor(inst: ADSR2Instance, startStep: AdsrStep, endStep: AdsrStep) {
    this.inst = inst;
    this.curve = this.renderRampCurve(startStep, endStep);
    this.handle = this.buildRampHandle(startStep, endStep);
  }

  private buildRampHandle(startStep: AdsrStep, endStep: AdsrStep) {
    switch (endStep.ramper.type) {
      case 'exponential': {
        return new RampHandle(this.inst, this, startStep, endStep);
      }
      default: {
        return null;
      }
    }
  }

  private computeRampCurve(step1: AdsrStep, step2: AdsrStep): { x: number; y: number }[] {
    switch (step2.ramper.type) {
      case 'linear': {
        return [
          { x: step1.x * this.inst.width, y: (1 - step1.y) * this.inst.height },
          { x: step2.x * this.inst.width, y: (1 - step2.y) * this.inst.height },
        ];
      }
      case 'exponential': {
        const widthPx = (step2.x - step1.x) * this.inst.width;
        const heightPx = (1 - step2.y - (1 - step1.y)) * this.inst.height;
        const pointCount = Math.ceil(widthPx / INTERPOLATED_SEGMENT_LENGTH_PX) + 1;

        const pts = [];
        for (let i = 0; i <= pointCount; i++) {
          const x = i / pointCount;
          const y = Math.pow(x, step2.ramper.exponent);
          pts.push({
            x: step1.x * this.inst.width + x * widthPx,
            y: (1 - step1.y) * this.inst.height + y * heightPx,
          });
        }
        return pts;
      }
      case 'instant': {
        return [
          { x: step1.x * this.inst.width, y: (1 - step1.y) * this.inst.height },
          { x: step2.x * this.inst.width, y: (1 - step1.y) * this.inst.height },
          { x: step2.x * this.inst.width, y: (1 - step2.y) * this.inst.height },
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
    if (this.curve) {
      this.inst.vizContainer.removeChild(this.curve);
      this.curve.destroy();
    }
    this.curve = this.renderRampCurve(startStep, endStep);
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

  private handleMove(newPos: PIXI.Point, thisHandleIx: number) {
    this.graphics.position = newPos;
    this.inst.sortAndUpdateMarks(thisHandleIx);
    this.inst.onUpdated();
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

        // Clamp first and last points to the start and end of the envelope
        const index = this.inst.steps.findIndex(s => s === this);
        if (index === 0) {
          newPosition.x = 0;
        } else if (index === this.inst.steps.length - 1) {
          newPosition.x = this.inst.width;
        } else {
          newPosition.x = R.clamp(0.001, this.inst.width - 0.0001, newPosition.x);
        }
        newPosition.y = R.clamp(0, this.inst.height - 0.0001, newPosition.y);

        this.step.x = newPosition.x / this.inst.width;
        this.step.y = 1 - newPosition.y / this.inst.height;
        this.handleMove(newPosition, index);
      })
      .on('rightdown', (evt: any) => {
        const data: PIXI.InteractionData = evt.data;
        data.originalEvent.preventDefault();
        data.originalEvent.stopPropagation();
        this.delete();
      });

    this.inst.vizContainer.addChild(g);
    g.x = this.step.x * this.inst.width;
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

  constructor(inst: ADSR2Instance, step: AdsrStep) {
    this.inst = inst;
    this.step = step;
    this.render();
  }

  public destroy() {
    this.inst.vizContainer.removeChild(this.graphics);
    this.graphics.destroy();
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
}

const LEFT_GUTTER_WIDTH_PX = 12;
const RIGHT_GUTTER_WIDTH_PX = 12;
const TOP_GUTTER_WIDTH_PX = 22;
const BOTTOM_GUTTER_WIDTH_PX = 22;

class ADSR2Instance {
  public app: PIXI.Application;
  private lengthMs = 1000;
  public steps!: StepHandle[];
  public sprites!: ADSR2Sprites;
  private loopPoint: number | null = null;
  private releasePoint!: number;
  private onChange: (newState: Adsr) => void;
  private lastClick: { time: number; pos: PIXI.Point } | null = null;
  private ctx: AudioContext;
  private audioThreadData: AudioThreadData;
  /**
   * Container into which the ADSR curve, handles, phase viz, and other pieces are rendered
   */
  public vizContainer: PIXI.Container;

  /**
   * Returns the width of the canvas in pixels minus the horizontal gutters
   */
  public get width() {
    return this.app.renderer.width - LEFT_GUTTER_WIDTH_PX - RIGHT_GUTTER_WIDTH_PX;
  }
  /**
   * Returns the height of the canvas in pixels minus the vertical gutters
   */
  public get height() {
    return this.app.renderer.height - TOP_GUTTER_WIDTH_PX - BOTTOM_GUTTER_WIDTH_PX;
  }

  public onUpdated() {
    this.onChange(this.serialize());
  }

  private setSteps(newSteps: AdsrStep[]) {
    this.steps.forEach(step => step.destroy());
    this.steps = newSteps.map(step => new StepHandle(this, R.clone(step)));
    this.sortAndUpdateMarks();
  }

  public update(state: Adsr) {
    if (isNaN(state.lenSamples)) {
      state.lenSamples = 1000;
    }

    const newLengthMs = (state.lenSamples / SAMPLE_RATE) * 1000;
    if (this.lengthMs !== newLengthMs) {
      this.lengthMs = newLengthMs;
      // TODO: Update rendering
    }

    if (!R.equals(this.steps.map(R.prop('step')), state.steps)) {
      this.setSteps(state.steps);
    }

    if (this.loopPoint !== state.loopPoint) {
      this.loopPoint = state.loopPoint;
      // TODO: Update rendering
    }

    if (this.releasePoint !== state.releasePoint) {
      this.loopPoint = state.loopPoint;
      // TODO: Update rendering
    }

    this.audioThreadData = state.audioThreadData;
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
    while (this.sprites.rampCurves.length > this.steps.length - 1) {
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
      this.sprites.rampCurves[curveIx] = new RampCurve(
        this,
        this.steps[curveIx].step,
        this.steps[curveIx + 1].step
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
    initialState: Adsr
  ) {
    const app = new PIXI.Application({
      antialias: true,
      view: canvas,
      height,
      width,
      backgroundColor: BACKGROUND_COLOR,
    });

    this.audioThreadData = initialState?.audioThreadData;
    this.app = app;
    this.onChange = onChange;
    this.ctx = ctx;

    this.vizContainer = new PIXI.Container();
    this.vizContainer.x = LEFT_GUTTER_WIDTH_PX;
    this.vizContainer.y = TOP_GUTTER_WIDTH_PX;
    // This means that z-indices actually work
    // this.vizContainer.sortableChildren = true;
    // basically `overflow: hidden`, I think
    this.vizContainer.mask = new PIXI.Graphics()
      .beginFill(0xffffff)
      .drawRect(LEFT_GUTTER_WIDTH_PX, TOP_GUTTER_WIDTH_PX, this.width, this.height)
      .endFill();

    this.initBackgroundClickHandler();

    if (initialState && !(initialState as any).attack) {
      this.deserialize(initialState);
    } else {
      this.steps = [
        { x: 0, y: 0.5, ramper: { type: 'linear' as const } },
        { x: 0.5, y: 0.8, ramper: { type: 'exponential' as const, exponent: 1.5 } },
        { x: 1, y: 0.5, ramper: { type: 'exponential' as const, exponent: 1.1 } },
      ].map(step => new StepHandle(this, step));
      this.releasePoint = 0.8;
    }

    this.renderInitial();
  }

  private addMark(pos: PIXI.Point) {
    const step = new StepHandle(this, {
      x: pos.x / this.width,
      y: 1 - pos.y / this.height,
      ramper: { type: 'exponential' as const, exponent: 0.1 },
    });
    this.steps.push(step);
    this.sortAndUpdateMarks();
    this.onChange(this.serialize());
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
      this.addMark(pos);
    });
    this.vizContainer.addChild(bg);
  }

  private renderInitial() {
    const rampCurves = [];
    for (let i = 0; i < this.steps.length - 1; i++) {
      rampCurves.push(new RampCurve(this, this.steps[i].step, this.steps[i + 1].step));
    }

    this.app.stage.addChild(this.vizContainer);

    this.sprites = { rampCurves };

    const phaseMarker = this.buildPhaseMarker();

    this.app.ticker.add(() => {
      if (!this.audioThreadData?.buffer) {
        return;
      }
      const phase = this.audioThreadData.buffer[this.audioThreadData.phaseIndex];
      phaseMarker.x = -this.width + phase * this.width;
    });
  }

  private deserialize(state: Adsr) {
    state.lenSamples = state.lenSamples ?? 1000;
    this.steps = state.steps.map(step => new StepHandle(this, R.clone(step)));
    this.lengthMs = (state.lenSamples / SAMPLE_RATE) * 1000;
    this.loopPoint = state.loopPoint;
    this.releasePoint = state.releasePoint;
  }

  public serialize(): Adsr {
    return {
      steps: this.steps.map(R.prop('step')),
      lenSamples: (this.lengthMs / 1000) * SAMPLE_RATE,
      loopPoint: this.loopPoint ?? 0,
      releasePoint: this.releasePoint,
      audioThreadData: this.audioThreadData!,
    };
  }

  public destroy() {
    this.app.destroy(false);
  }
}

interface ADSR2Props {
  width?: number;
  height?: number;
  initialState: Adsr;
  onChange: (newState: Adsr) => void;
}

const ADSR2: React.FC<ADSR2Props> = ({ width = 600, height = 480, initialState, onChange }) => {
  const instance = useRef<ADSR2Instance | null>(null);

  useEffect(() => {
    if (!instance.current || !initialState) {
      return;
    }

    instance.current.update(initialState);
  }, [initialState]);

  return (
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

        instance.current = new ADSR2Instance(width, height, canvas, onChange, ctx, initialState);
      }}
    />
  );
};

export default ADSR2;
