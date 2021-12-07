import React, { useEffect, useRef } from 'react';

const Conf = {
  disabledColor: '#292929',
  backgroundColor: '#121212',
  phaseIndicatorColor: '#19d4d1',
};

class LooperVizInst {
  private bankIx: number;
  private phaseSAB: Float32Array;
  private ctx: CanvasRenderingContext2D;
  private isRunning = true;
  private width: number;
  private height: number;
  private lastRenderedPhase: number | null = 0;

  constructor(
    bankIx: number,
    phaseSAB: Float32Array,
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number
  ) {
    this.bankIx = bankIx;
    this.phaseSAB = phaseSAB;
    this.ctx = ctx;
    this.width = width;
    this.height = height;

    this.draw();
  }

  public setCtx(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  public draw() {
    if (!this.isRunning) {
      return;
    }

    const isActive = this.phaseSAB[1] === this.bankIx;
    if (!isActive) {
      if (this.lastRenderedPhase === null) {
        requestAnimationFrame(() => this.draw());
        return;
      }

      this.ctx.fillStyle = Conf.disabledColor;
      this.ctx.fillRect(0, 0, this.width, this.height);
      this.lastRenderedPhase = null;
      requestAnimationFrame(() => this.draw());
      return;
    }

    this.ctx.fillStyle = Conf.backgroundColor;
    this.ctx.fillRect(0, 0, this.width, this.height);

    const phase = this.phaseSAB[0];
    this.lastRenderedPhase = phase;
    const x = phase * this.width;
    this.ctx.strokeStyle = Conf.phaseIndicatorColor;
    this.ctx.beginPath();
    this.ctx.moveTo(x, 0);
    this.ctx.lineTo(x, this.height);
    this.ctx.stroke();

    requestAnimationFrame(() => this.draw());
  }

  public start() {
    this.isRunning = true;
    this.draw();
  }

  public stop() {
    this.isRunning = false;
  }
}

interface LooperVizProps {
  bankIx: number;
  phaseSAB: Float32Array;
  width: number;
  height: number;
}

const LooperViz: React.FC<LooperVizProps> = ({ bankIx, phaseSAB, width, height }) => {
  const inst = useRef<LooperVizInst | null>(null);

  useEffect(() => () => inst.current?.stop(), []);

  return (
    <canvas
      className='looper-viz'
      width={width}
      height={height}
      ref={canvas => {
        if (!canvas) {
          inst.current?.stop();
          inst.current = null;
          return;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          console.error('Failed to get canvas 2D context');
          return;
        }
        if (inst.current) {
          inst.current.setCtx(ctx);
        } else {
          inst.current = new LooperVizInst(bankIx, phaseSAB, ctx, width, height);
        }
      }}
    />
  );
};

export default LooperViz;
