import { UnimplementedError } from 'ameo-utils';
import { EffectType, Effect } from 'src/redux/modules/synthDesigner';

export interface EffectNode extends AudioNode {
  setParam: (key: string, val: number) => void;
  getSettingDefs: () => { [key: string]: any }[];
  getDefaultParams: () => { [key: string]: any };
}

export class Bitcrusher extends AudioWorkletNode {
  constructor(audioContext: AudioContext) {
    super(audioContext, 'bitcrusher');
  }

  public setParam = (key: string, val: number) => {
    throw new UnimplementedError();
  };

  public getSettingDefs = () => [{ type: 'range', label: 'bits', min: 1, max: 12, stepSize: 1 }];

  public getDefaultParams = () => ({ bits: 4 });
}

export class Distortion extends WaveShaperNode {
  public setParam = (key: string, val: number) => {
    throw new UnimplementedError();
  };

  public getSettingDefs = () => [] as { [key: string]: any }[];

  public getDefaultParams = () => ({} as { [key: string]: any });
}

export class Reverb extends ConvolverNode {
  public setParam = (key: string, val: number) => {
    throw new UnimplementedError();
  };

  public getSettingDefs = () => [];

  public getDefaultParams = () => ({} as { [key: string]: any });
}

const ctx = new AudioContext();

const effectsMap: { [K in EffectType]: () => EffectNode } = {
  [EffectType.Bitcrusher]: () => new Bitcrusher(ctx),
  [EffectType.Distortion]: () => new Distortion(ctx),
  [EffectType.Reverb]: () => new Reverb(ctx),
};

export const buildEffect = (
  type: EffectType
): { params: { [key: string]: any }; effect: Effect } => {
  const node = effectsMap[type]();
  const params = node.getDefaultParams();
  return { params, effect: { type, node } };
};
