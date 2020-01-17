import * as R from 'ramda';
import { Option } from 'funfix-core';

import { ADSRValues, defaultAdsrEnvelope } from 'src/controls/adsr';

export class ADSRModule extends ConstantSourceNode {
  private ctx: AudioContext;
  public minValue: number;
  public maxValue: number;
  private lengthMs: number;
  private envelope: ADSRValues = defaultAdsrEnvelope;

  constructor(
    ctx: AudioContext,
    {
      minValue = 0,
      maxValue = 1,
      lengthMs = 1000,
    }: { minValue?: number; maxValue?: number; lengthMs?: number }
  ) {
    super(ctx);

    this.ctx = ctx;
    this.minValue = minValue;
    this.maxValue = maxValue;
    this.lengthMs = lengthMs;

    this.offset.setValueAtTime(this.minValue, ctx.currentTime);
  }

  public setLengthMs(newLengthMs: number) {
    this.lengthMs = newLengthMs;
  }

  public setMinValue(newMinValue: number) {
    this.minValue = newMinValue;
  }

  public setMaxValue(newMaxValue: number) {
    this.maxValue = newMaxValue;
  }

  public setEnvelope(newEnvelope: ADSRValues) {
    this.envelope = newEnvelope;
  }

  /**
   * Triggers the ADSR to implement the signal, triggering ramps to each of the levels defined by the envelope to the
   * underlying `ConstantSourceNode` and effecting all connected `AudioParam`s
   */
  public gate(offset?: number) {
    // start out off at the minimum
    if (R.isNil(offset)) {
      this.offset.cancelScheduledValues(0);
      this.offset.linearRampToValueAtTime(this.minValue, this.ctx.currentTime + 0.0001);
    } else {
      this.offset.setValueAtTime(this.minValue, this.ctx.currentTime + offset);
    }

    const realOffset = Option.of(offset).getOrElse(0);
    const range = this.maxValue - this.minValue;
    const { attack, decay } = this.envelope;

    // Ramp to the attack
    this.offset.linearRampToValueAtTime(
      this.minValue + attack.magnitude * range,
      this.ctx.currentTime + (attack.pos * this.lengthMs) / 1000.0 + realOffset
    );
    // Ramp to the decay and hold there
    this.offset.linearRampToValueAtTime(
      this.minValue + decay.magnitude * range,
      this.ctx.currentTime + (decay.pos * this.lengthMs) / 1000.0 + realOffset
    );
  }

  /**
   * Triggers the start of the release.  This will override all other envelope ramp events that are currently queued
   * and start ramping to zero immediately.
   */
  public ungate(offset?: number) {
    const range = this.maxValue - this.minValue;
    const { release, decay } = this.envelope;

    if (R.isNil(offset)) {
      // Clear any queued ramp events
      this.offset.cancelScheduledValues(0);
    } else {
      this.offset.cancelScheduledValues(this.ctx.currentTime + offset);
      this.offset.linearRampToValueAtTime(
        this.minValue + decay.magnitude * range,
        this.ctx.currentTime + offset
      );
    }

    const releaseDuration = ((1.0 - release.pos) * this.lengthMs) / 1000.0;
    this.offset.linearRampToValueAtTime(
      this.minValue,
      this.ctx.currentTime + releaseDuration + Option.of(offset).getOrElse(0)
    );
  }
}
