import { ADSRValues, defaultAdsrEnvelope } from 'src/controls/adsr';

export class ADSRModule extends ConstantSourceNode {
  private ctx: AudioContext;
  private minValue: number;
  private maxValue: number;
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
    // start out off at the minimum
    this.offset.cancelScheduledValues(0);
    this.offset.setValueAtTime(this.minValue, this.ctx.currentTime);
    this.offset.linearRampToValueAtTime(this.minValue, this.ctx.currentTime + 0.0001);

    const range = this.maxValue - this.minValue;

    const { attack, decay } = this.envelope;

    console.log(`now: ${this.ctx.currentTime}: ${this.minValue}`);
    // Ramp to the attack
    this.offset.linearRampToValueAtTime(
      this.minValue + attack.magnitude * range,
      this.ctx.currentTime + (attack.pos * this.lengthMs) / 1000.0
    );
    console.log(
      `attack: ${this.ctx.currentTime + attack.pos * (this.lengthMs / 1000.0)}: ${this.minValue +
        attack.magnitude * range}`
    );
    // Ramp to the decay and hold there
    this.offset.linearRampToValueAtTime(
      this.minValue + decay.magnitude * range,
      this.ctx.currentTime + (decay.pos * this.lengthMs) / 1000.0
    );
    console.log(
      `decay: ${this.ctx.currentTime + decay.pos * (this.lengthMs / 1000.0)}: ${this.minValue +
        decay.magnitude * range}`
    );
  }

  /**
   * Triggers the start of the release.  This will override all other envelope ramp events that are currently queued
   * and start ramping to zero immediately.
   */
  public ungate() {
    const { release } = this.envelope;

    // Clear any queued ramp events
    this.offset.cancelScheduledValues(0);

    const releaseDuration = ((1.0 - release.pos) * this.lengthMs) / 1000.0;
    this.offset.linearRampToValueAtTime(this.minValue, this.ctx.currentTime + releaseDuration);
  }
}
