import * as R from 'ramda';
import { UnreachableException } from 'ameo-utils';

import { FilterType } from 'src/synthDesigner/filterHelpers';
import { FilterParams } from 'src/redux/modules/synthDesigner';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import { linearToDb } from 'src/util';
import { connectFilterChain } from 'src/filterDesigner/util';

// higher-order filter Q factors determined using this: https://www.earlevel.com/main/2016/09/29/cascading-filters/
export const computeHigherOrderBiquadQFactors = (order: number): number[] => {
  if (order % 2 !== 0 || order <= 0) {
    throw new UnreachableException('order must be even and greater than 0');
  }

  return R.range(0, order / 2).map(i =>
    linearToDb(1 / (2 * Math.cos(Math.PI / order / 2 + (Math.PI / order) * i)))
  );
};

export interface FilterCSNs {
  frequency: OverridableAudioParam;
  Q: OverridableAudioParam;
  detune: OverridableAudioParam;
  gain: OverridableAudioParam;
}

export declare class AbstractFilterModule {
  constructor(ctx: AudioContext, type: FilterType, params: FilterParams, csns: FilterCSNs);

  public getInput(): BiquadFilterNode;
  public getOutput(): BiquadFilterNode;

  public destroy(): void;
}

const buildConnectedFilterChain = (
  ctx: AudioContext,
  type: FilterType.Highpass | FilterType.Lowpass,
  qFactors: number[]
): BiquadFilterNode[] => {
  const chain = qFactors.map(q => {
    const filter = new BiquadFilterNode(ctx);
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.value = 0;
    return filter;
  });
  connectFilterChain(chain);
  return chain;
};

export class HigherOrderBiquadFilter implements AbstractFilterModule {
  private ctx: AudioContext;
  private type: FilterType;
  private inner: BiquadFilterNode[];

  private buildInner(): BiquadFilterNode[] {
    switch (this.type) {
      case FilterType.LP4: {
        return buildConnectedFilterChain(
          this.ctx,
          FilterType.Lowpass,
          computeHigherOrderBiquadQFactors(4)
        );
      }
      case FilterType.LP8: {
        return buildConnectedFilterChain(
          this.ctx,
          FilterType.Lowpass,
          computeHigherOrderBiquadQFactors(8)
        );
      }
      case FilterType.LP16: {
        return buildConnectedFilterChain(
          this.ctx,
          FilterType.Lowpass,
          computeHigherOrderBiquadQFactors(16)
        );
      }
      case FilterType.HP4: {
        return buildConnectedFilterChain(
          this.ctx,
          FilterType.Highpass,
          computeHigherOrderBiquadQFactors(4)
        );
      }
      case FilterType.HP8: {
        return buildConnectedFilterChain(
          this.ctx,
          FilterType.Highpass,
          computeHigherOrderBiquadQFactors(8)
        );
      }
      case FilterType.HP16: {
        return buildConnectedFilterChain(
          this.ctx,
          FilterType.Highpass,
          computeHigherOrderBiquadQFactors(16)
        );
      }

      default: {
        throw new UnreachableException('must supply higher order filter type to this class');
      }
    }
  }

  constructor(ctx: AudioContext, type: FilterType, csns: FilterCSNs) {
    this.ctx = ctx;
    this.type = type;
    this.inner = this.buildInner();

    this.inner.forEach(node => {
      // do not connect Q except for the last node since we artisinally craft the other Q factors to
      // preserve a butterworth frequency repsonse
      csns.detune.outputCSN!.connect(node.detune);
      csns.frequency.outputCSN!.connect(node.frequency);
      csns.gain.outputCSN!.connect(node.gain);
    });

    csns.Q.outputCSN!.connect(R.last(this.inner)!.Q);
  }

  public getInput(): BiquadFilterNode {
    return this.inner[0];
  }
  public getOutput(): BiquadFilterNode {
    return R.last(this.inner)!;
  }

  public destroy() {
    this.inner.forEach(node => node.disconnect());
  }
}

/**
 * A digital filter that's either a simple single `BiquadFilter` or more complicated filter
 * chain or something else internally.  Abstracts over the interior and makes it possible to use
 * different types from a single interface and change between them easily.
 */
export class SingleBiquadFilterModule implements AbstractFilterModule {
  private ctx: AudioContext;
  private type: FilterType;
  private inner: BiquadFilterNode;

  private buildInner(): BiquadFilterNode {
    switch (this.type) {
      case FilterType.Lowpass:
      case FilterType.Highpass:
      case FilterType.Bandpass:
      case FilterType.Lowshelf:
      case FilterType.Highshelf:
      case FilterType.Peaking:
      case FilterType.Notch:
      case FilterType.Allpass: {
        const node = new BiquadFilterNode(this.ctx);
        node.type = this.type;
        node.Q.value = 0;
        node.frequency.value = 0;
        return node;
      }
      default: {
        throw new UnreachableException(
          'must supply simple filter type to `SingleBiquadFilterModule`'
        );
      }
    }
  }

  public getInput(): BiquadFilterNode {
    return this.inner;
  }
  public getOutput(): BiquadFilterNode {
    return this.inner;
  }

  constructor(ctx: AudioContext, type: FilterType, csns: FilterCSNs) {
    this.ctx = ctx;
    this.type = type;
    this.inner = this.buildInner();

    csns.frequency.outputCSN!.connect(this.inner.frequency);
    csns.Q.outputCSN!.connect(this.inner.Q);
    csns.detune.outputCSN!.connect(this.inner.detune);
    csns.gain.outputCSN!.connect(this.inner.gain);
  }

  public destroy() {
    this.inner.disconnect();
  }
}

export const buildAbstractFilterModule = (
  ctx: AudioContext,
  type: FilterType,
  csns: FilterCSNs
): AbstractFilterModule => {
  switch (type) {
    case FilterType.Lowpass:
    case FilterType.Highpass:
    case FilterType.Bandpass:
    case FilterType.Lowshelf:
    case FilterType.Highshelf:
    case FilterType.Peaking:
    case FilterType.Notch:
    case FilterType.Allpass: {
      return new SingleBiquadFilterModule(ctx, type, csns);
    }

    case FilterType.LP4:
    case FilterType.LP8:
    case FilterType.LP16:
    case FilterType.HP4:
    case FilterType.HP8:
    case FilterType.HP16: {
      return new HigherOrderBiquadFilter(ctx, type, csns);
    }

    default: {
      throw new UnreachableException(`Unhandled filter type: ${type}`);
    }
  }
};
