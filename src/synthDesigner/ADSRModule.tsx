import { ADSRValues, defaultAdsrEnvelope } from 'src/controls/adsr';

export class ADSRModule extends ConstantSourceNode {
  private ctx: AudioContext;
  public minValue: number;
  public maxValue: number;
  public lengthMs = 1000;
  public envelope: ADSRValues = defaultAdsrEnvelope;

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
  public gate() {
    if (!this.lengthMs) {
      console.warn('Tried to gate ADSR before value recorder initialized');
      return;
    }

    this.offset.cancelScheduledValues(0);

    const range = this.maxValue - this.minValue;
    const { attack, decay } = this.envelope;

    // Ramp to the attack
    if (attack.pos > 0) {
      this.offset.exponentialRampToValueAtTime(
        Math.max(this.minValue + attack.magnitude * range, 0.0001),
        this.ctx.currentTime + (attack.pos * this.lengthMs) / 1000.0
      );
    } else {
      this.offset.setValueAtTime(this.minValue + attack.magnitude * range, this.ctx.currentTime);
    }
    // Ramp to the decay and hold there
    if (decay.pos - attack.pos > 0) {
      this.offset.exponentialRampToValueAtTime(
        Math.max(this.minValue + decay.magnitude * range, 0.0001),
        this.ctx.currentTime + (decay.pos * this.lengthMs) / 1000.0
      );
    } else {
      this.offset.setValueAtTime(this.minValue + decay.magnitude * range, this.ctx.currentTime);
    }
  }

  /**
   * Triggers the start of the release.  This will override all other envelope ramp events that are currently queued
   * and start ramping to zero immediately.
   */
  public ungate() {
    if (!this.lengthMs) {
      console.warn('Tried to ungate ADSR before value recorder initialized');
      return;
    }

    const { release } = this.envelope;

    // Clear any queued ramp events
    this.offset.cancelScheduledValues(0);

    const releaseDuration = ((1.0 - release.pos) * this.lengthMs) / 1000.0;
    this.offset.exponentialRampToValueAtTime(
      this.minValue === 0 ? 0.0001 : this.minValue,
      this.ctx.currentTime + releaseDuration
    );
  }
}
