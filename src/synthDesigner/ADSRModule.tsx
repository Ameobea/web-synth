import * as R from 'ramda';
import { Option } from 'funfix-core';

import { ADSRValues, defaultAdsrEnvelope } from 'src/controls/adsr';
import { createValueRecorder, ValueRecorder } from 'src/graphEditor/nodes/ValueRecorderNode';

export class ADSRModule extends ConstantSourceNode {
  private ctx: AudioContext;
  public minValue: number;
  public maxValue: number;
  public lengthMs: ValueRecorder | null = null;
  private onLengthValueRecordedInitialzedCbs: ((recorder: ValueRecorder) => void)[] = [];
  public envelope: ADSRValues = defaultAdsrEnvelope;
  private mostRecentGateTime: number | null = null;

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

    this.offset.setValueAtTime(this.minValue, ctx.currentTime);

    createValueRecorder(ctx, lengthMs).then(valueRecorder => {
      this.lengthMs = valueRecorder;
      this.lengthMs.value = lengthMs;

      this.onLengthValueRecordedInitialzedCbs.forEach(cb => cb(valueRecorder));
      this.onLengthValueRecordedInitialzedCbs = [];
    });
  }

  public onLengthValueRecordedInitialzed(cb: (recorder: ValueRecorder) => void) {
    if (this.lengthMs) {
      cb(this.lengthMs);
      return;
    }
    this.onLengthValueRecordedInitialzedCbs.push(cb);
  }

  public setLengthMs(newLengthMs: number) {
    if (!this.lengthMs) {
      console.warn('Tried to set ADSR length before value recorder initialized');
      return;
    }
    this.lengthMs.value = newLengthMs;
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
    if (!this.lengthMs) {
      console.warn('Tried to gate ADSR before value recorder initialized');
      return;
    }

    this.mostRecentGateTime = this.ctx.currentTime;
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
      this.ctx.currentTime + (attack.pos * this.lengthMs.lastValue) / 1000.0 + realOffset
    );
    // Ramp to the decay and hold there
    this.offset.linearRampToValueAtTime(
      this.minValue + decay.magnitude * range,
      this.ctx.currentTime + (decay.pos * this.lengthMs.lastValue) / 1000.0 + realOffset
    );
  }

  /**
   * Triggers the start of the release.  This will override all other envelope ramp events that are currently queued
   * and start ramping to zero immediately.
   */
  public ungate(offset?: number, onReleaseFinished?: () => void) {
    if (!this.lengthMs) {
      console.warn('Tried to ungate ADSR before value recorder initialized');
      return;
    }

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

    const releaseDuration = ((1.0 - release.pos) * this.lengthMs.lastValue) / 1000.0;
    this.offset.linearRampToValueAtTime(
      this.minValue,
      this.ctx.currentTime + releaseDuration + Option.of(offset).getOrElse(0)
    );

    if (onReleaseFinished) {
      const prevMostRecentGateTime = this.mostRecentGateTime;
      setTimeout(() => {
        // If a new attack has been triggered before the previous release finished, don't call
        // the onReleaseFinished cb
        if (this.mostRecentGateTime !== prevMostRecentGateTime) {
          return;
        }

        onReleaseFinished();
        // Add some extra time to avoid imprecision caused by settimeout
      }, (releaseDuration + Option.of(offset).getOrElse(0)) * 1000 + 2500);
    }
  }
}
