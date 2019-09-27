import { UnimplementedError } from 'ameo-utils';
import { EffectType, Effect } from 'src/redux/modules/synthDesigner';

export interface EffectNode extends AudioNode {
  setParam: (key: string, val: number) => void;
  getSettingDefs: () => { [key: string]: any }[];
  getDefaultParams: () => { [key: string]: any };
}

export class Bitcrusher extends AudioNode {
  public setParam = (key: string, val: number) => {
    throw new UnimplementedError();
  };

  public getSettingDefs = () => [{ type: 'range', label: 'bits', min: 1, max: 12, stepSize: 1 }];

  getDefaultParams = () => ({ bits: 4 });
}

export class Distortion extends AudioNode {
  public setParam = (key: string, val: number) => {
    throw new UnimplementedError();
  };

  public getSettingDefs = () => [];

  getDefaultParams = () => ({});
}

export class Reverb extends AudioNode {
  public setParam = (key: string, val: number) => {
    throw new UnimplementedError();
  };

  public getSettingDefs = () => [];

  getDefaultParams = () => ({});
}

const effectsMap: { [K in EffectType]: new () => EffectNode } = {
  [EffectType.Bitcrusher]: Bitcrusher,
  [EffectType.Distortion]: Distortion,
  [EffectType.Reverb]: Reverb,
};

export const buildEffect = (
  type: EffectType
): { params: { [key: string]: any }; effect: Effect } => {
  const node = new effectsMap[type]();
  const params = node.getDefaultParams();
  return { params, effect: { type, node } };
};
