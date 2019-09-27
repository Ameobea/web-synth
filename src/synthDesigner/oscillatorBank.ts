import * as R from 'ramda';
import { Option } from 'funfix-core';

const OSCILLATOR_BANK_SIZE = 128 as const;

const audioCtx = new AudioContext();

export default class OscillatorBank {
  private freeOscillators: OscillatorNode[];
  private usedOscillators: (OscillatorNode | number | null)[];
  private usedOscillatorsFreePtr: number | null = 0;

  constructor() {
    this.freeOscillators = R.times(R.identity, OSCILLATOR_BANK_SIZE).map(
      () => new OscillatorNode(audioCtx)
    );
    this.usedOscillators = R.times(R.identity, OSCILLATOR_BANK_SIZE).map(i =>
      i === OSCILLATOR_BANK_SIZE - 1 ? null : i - 1
    );
  }

  public allocateOscillator = (): Option<number> => {
    const freeIx = this.usedOscillatorsFreePtr;
    if (R.isNil(freeIx)) {
      return Option.none();
    }

    const oscillator = this.freeOscillators.shift();
    if (!oscillator) {
      throw new Error(
        `Got oscillator that was null when our free pointer said there was one. Free ptr: ${this.usedOscillatorsFreePtr}`
      );
    }

    const nextFreePtr = this.usedOscillators[freeIx];
    if (typeof nextFreePtr !== 'number' && nextFreePtr !== null) {
      throw new Error(`Node under free pointer pointed to non-free entry at index ${nextFreePtr}`);
    }

    this.usedOscillatorsFreePtr = nextFreePtr;
    this.usedOscillators[freeIx] = oscillator;

    return Option.of(freeIx);
  };

  public freeOscillator = (ix: number) => {
    const oscillator = this.usedOscillators[ix];
    if (oscillator === null || typeof oscillator === 'number') {
      console.error(
        `Tried to free oscillator at index ${ix} but it was not occupied; it was ${oscillator}`
      );
      return;
    }

    oscillator.disconnect();
    this.freeOscillators.push(oscillator);
    this.usedOscillators[ix] = this.usedOscillatorsFreePtr;
    this.usedOscillatorsFreePtr = ix;
  };

  public serialize = (): string =>
    JSON.stringify({
      usedOscillatorsFreePtr: this.usedOscillatorsFreePtr,
      usedOscillators: this.usedOscillators.map(nodeOpt =>
        nodeOpt !== null && typeof nodeOpt !== 'number' ? true : nodeOpt
      ),
    });

  public deserialize = (serialized: string) => {
    const { usedOscillatorsFreePtr, usedOscillators } = JSON.parse(serialized);
    this.usedOscillatorsFreePtr = usedOscillatorsFreePtr;
    this.usedOscillators = usedOscillators.map((osc: null | number | true) =>
      osc === true ? this.freeOscillators.pop() : osc
    );
  };
}
