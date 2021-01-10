import React, { useRef } from 'react';
import * as PIXI from 'pixi.js';
import * as R from 'ramda';

import { AdsrStep } from 'src/graphEditor/nodes/CustomAudio/FMSynth/FMSynth';

const BACKGROUND_COLOR = 0x131313;
const LINE_COLOR = 0x33dd88;
const INTERPOLATED_SEGMENT_LENGTH_PX = 2;
const STEP_HANDLE_WIDTH = 8;
const HANDLE_COLOR = 0x4399ab;
const ctx = new AudioContext();

interface SerializedADSR2State {
  steps: AdsrStep[];
  lengthMs: number;
  loopPoint: number | null;
  decayPoint: number;
}

interface ADSR2Sprites {
  rampCurves: PIXI.Graphics[];
}

class StepHandle {
  private inst: ADSR2Instance;
  private graphics!: PIXI.Graphics;
  private dragData: PIXI.InteractionData | null = null;
  public step: AdsrStep;

  private handleMove(newPos: PIXI.Point) {
    this.graphics.position = newPos;
    this.inst.sortAndUpdateMarks();
    this.inst.onChange(this.inst.serialize());
  }

  private render() {
    const g = new PIXI.Graphics();
    g.lineStyle(1, 0x000000);
    g.beginFill(HANDLE_COLOR);
    g.drawCircle(0, 0, STEP_HANDLE_WIDTH);
    g.endFill();

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
        this.step.y = newPosition.y / this.inst.height;
        this.handleMove(newPosition);
      });

    this.inst.app.stage.addChild(g);
    g.x = this.step.x * this.inst.width;
    g.y = this.step.y * this.inst.height;
    this.graphics = g;
  }

  constructor(inst: ADSR2Instance, step: AdsrStep) {
    this.inst = inst;
    this.step = step;
    this.render();
  }
}

class ADSR2Instance {
  public app: PIXI.Application;
  private lengthMs = 1000;
  public steps!: StepHandle[];
  private sprites!: ADSR2Sprites;
  private loopPoint: number | null = null;
  private decayPoint!: number;
  public onChange: (newState: SerializedADSR2State) => void;
  private lastClick: { time: number; pos: PIXI.Point } | null = null;
  private ctx: AudioContext;

  public get width() {
    return this.app.renderer.width;
  }
  public get height() {
    return this.app.renderer.height;
  }

  public sortAndUpdateMarks() {
    const prevSteps = [...this.steps];
    this.steps = R.sortBy(step => step.step.x, this.steps);

    this.steps.forEach((step, i) => {
      if (
        i === 0 ||
        (step.step.x === prevSteps[i].step.x &&
          step.step.y === prevSteps[i].step.y &&
          step.step.x === prevSteps[i - 1].step.x &&
          step.step.y === prevSteps[i - 1].step.y)
      ) {
        return;
      }

      this.app.stage.removeChild(this.sprites.rampCurves[i - 1]);
      this.sprites.rampCurves[i - 1]?.destroy();
      this.sprites.rampCurves[i - 1] = this.renderRampCurve(
        this.steps[i - 1].step,
        this.steps[i].step
      );
    });
  }

  private computeRampCurve(step1: AdsrStep, step2: AdsrStep): { x: number; y: number }[] {
    switch (step2.ramper.type) {
      case 'linear': {
        return [
          { x: step1.x * this.width, y: step1.y * this.height },
          { x: step2.x * this.width, y: step2.y * this.height },
        ];
      }
      case 'exponential': {
        const widthPx = (step2.x - step1.x) * this.width;
        const heightPx = (step2.y - step1.y) * this.height;
        const pointCount = Math.ceil(widthPx / INTERPOLATED_SEGMENT_LENGTH_PX) + 1;

        const pts = [];
        for (let i = 0; i <= pointCount; i++) {
          const x = i / pointCount;
          const y = Math.pow(x, step2.ramper.exponent);
          pts.push({
            x: step1.x * this.width + x * widthPx,
            y: step1.y * this.height + y * heightPx,
          });
        }
        return pts;
      }
      case 'instant': {
        return [
          { x: step1.x * this.width, y: step1.y * this.height },
          { x: step2.x * this.width, y: step1.y * this.height },
          { x: step2.x * this.width, y: step2.y * this.height },
        ];
      }
    }
  }

  private renderRampCurve(step1: AdsrStep, step2: AdsrStep): PIXI.Graphics {
    const graphics = new PIXI.Graphics();
    graphics.lineStyle(2.5, LINE_COLOR, 1, 0.5);
    const [start, ...points] = this.computeRampCurve(step1, step2);
    graphics.moveTo(start.x, start.y);
    points.forEach(({ x, y }) => graphics.lineTo(x, y));
    this.app.stage.addChild(graphics);
    return graphics;
  }

  constructor(
    width: number,
    height: number,
    canvas: HTMLCanvasElement,
    onChange: (newState: SerializedADSR2State) => void,
    ctx: AudioContext,
    initialState?: SerializedADSR2State
  ) {
    const app = new PIXI.Application({
      antialias: true,
      view: canvas,
      height,
      width,
      backgroundColor: BACKGROUND_COLOR,
    });
    this.app = app;
    this.onChange = onChange;
    this.ctx = ctx;

    this.initBackgroundClickHandler();

    if (initialState) {
      this.deserialize(initialState);
    } else {
      this.steps = [
        { x: 0, y: 0.5, ramper: { type: 'linear' as const } },
        { x: 0.5, y: 0.8, ramper: { type: 'linear' as const } },
        { x: 1, y: 0.5, ramper: { type: 'linear' as const } },
      ].map(step => new StepHandle(this, step));
      this.decayPoint = 0.8;
    }

    this.renderInitial();
  }

  private addMark(pos: PIXI.Point) {
    const step = new StepHandle(this, {
      x: pos.x / this.width,
      y: pos.y / this.height,
      ramper: { type: 'exponential' as const, exponent: 0.1 },
    });
    this.steps.push(step);
    this.sortAndUpdateMarks();
    this.onChange(this.serialize());
  }

  private initBackgroundClickHandler() {
    const bg = new PIXI.Sprite(PIXI.Texture.EMPTY);
    bg.width = this.width;
    bg.height = this.height;
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
    this.app.stage.addChild(bg);
  }

  private renderInitial() {
    const rampCurves: PIXI.Graphics[] = [];
    for (let i = 0; i < this.steps.length - 1; i++) {
      rampCurves.push(this.renderRampCurve(this.steps[i].step, this.steps[i + 1].step));
    }

    this.sprites = { rampCurves };
  }

  private deserialize(state: SerializedADSR2State) {
    this.steps = state.steps.map(step => new StepHandle(this, step));
    this.lengthMs = state.lengthMs;
    this.loopPoint = state.loopPoint;
    this.decayPoint = state.decayPoint;
  }

  public serialize(): SerializedADSR2State {
    return {
      steps: this.steps.map(step => step.step),
      lengthMs: this.lengthMs,
      loopPoint: this.loopPoint,
      decayPoint: this.decayPoint,
    };
  }
}

interface ADSR2Props {
  width?: number;
  height?: number;
  initialState?: SerializedADSR2State;
  onChange: (newState: SerializedADSR2State) => void;
}

const ADSR2: React.FC<ADSR2Props> = ({ width = 600, height = 380, initialState, onChange }) => {
  const instance = useRef<ADSR2Instance | null>(null);

  return (
    <canvas
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
