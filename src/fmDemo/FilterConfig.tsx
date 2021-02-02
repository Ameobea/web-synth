import React, { useMemo, useState } from 'react';
import ControlPanel from 'react-control-panel';

import type { ADSRValues } from 'src/controls/adsr';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import type { FilterParams } from 'src/redux/modules/synthDesigner';
import { ADSRModule } from 'src/synthDesigner/ADSRModule';
import {
  AbstractFilterModule,
  buildAbstractFilterModule,
  FilterCSNs,
} from 'src/synthDesigner/biquadFilterModule';
import { FilterType, getSettingsForFilterType } from 'src/synthDesigner/filterHelpers';

export class FilterContainer {
  private ctx: AudioContext;
  private csns: FilterCSNs;
  private input: GainNode;
  private output: GainNode;
  private inner: AbstractFilterModule;

  constructor(ctx: AudioContext, params: FilterParams) {
    this.ctx = ctx;
    this.input = new GainNode(ctx);
    this.output = new GainNode(ctx);
    this.csns = {
      frequency: new OverridableAudioParam(ctx),
      detune: new OverridableAudioParam(ctx),
      Q: new OverridableAudioParam(ctx),
      gain: new OverridableAudioParam(ctx),
    };
    this.csns.Q.manualControl.offset.value = params.Q ?? 0;
    this.csns.detune.manualControl.offset.value = params.detune;
    this.csns.frequency.manualControl.offset.value = params.frequency;
    this.csns.gain.manualControl.offset.value = params.gain ?? 0;

    this.inner = buildAbstractFilterModule(ctx, params.type, this.csns);
    this.input.connect(this.inner.getInput());
    this.inner.getOutput().connect(this.output);
  }

  public set(key: 'frequency' | 'detune' | 'gain' | 'Q', val: number) {
    this.csns[key].manualControl.offset.value = val;
  }
  public setType(newType: FilterType) {
    this.input.disconnect(this.inner.getInput());
    this.inner.destroy();

    this.inner = buildAbstractFilterModule(this.ctx, newType, this.csns);
    this.input.connect(this.inner.getInput());
    this.inner.getOutput().connect(this.output);
  }
  public setAll(params: FilterParams) {
    this.setType(params.type);
    Object.keys(params)
      .filter(k => (this.csns as any)[k])
      .forEach(k => this.set(k as any, params[k as keyof typeof params] as any));
  }

  public getInput() {
    return this.input;
  }
  public getOutput() {
    return this.output;
  }
}

const handleFilterChange = (
  filters: FilterContainer[],
  adsrs: ADSRModule[],
  state: { params: FilterParams; envelope: ADSRValues; bypass: boolean; envelopeLenMs: number },
  key: string,
  val: any
) => {
  const newState = { ...state, params: { ...state.params } };
  switch (key) {
    case 'frequency':
    case 'Q':
    case 'gain':
    case 'detune':
      newState.params[key] = val;
      filters.forEach(filter => filter.set(key, val));
      break;
    case 'type': {
      filters.forEach(filter => filter.setType(val));
      newState.params.type = val;
      break;
    }
    case 'adsr length ms': {
      adsrs.forEach(adsr => adsr.setLengthMs(val));
      newState.envelopeLenMs = val;
      break;
    }
    case 'adsr': {
      adsrs.forEach(adsr => adsr.setEnvelope(val));
      newState.envelope = val;
      break;
    }
    case 'bypass': {
      newState.bypass = val;
      break;
    }
    default: {
      console.error('Unhandled key in filter config: ', key);
    }
  }
  return newState;
};

const FilterConfig: React.FC<{
  initialState: {
    params: FilterParams;
    envelope: ADSRValues;
    bypass: boolean;
    envelopeLenMs: number;
  };
  filters: FilterContainer[];
  adsrs: ADSRModule[];
  onChange: (
    params: FilterParams,
    envelope: ADSRValues,
    bypass: boolean,
    envelopeLenMs: number
  ) => void;
}> = ({ initialState, filters, adsrs, onChange }) => {
  const [state, setState] = useState(initialState);

  const settings = useMemo(() => getSettingsForFilterType(state.params.type), [state.params.type]);
  const controlPanelState = useMemo(
    () => ({
      ...state.params,
      adsr: state.envelope,
      bypass: state.bypass,
      'adsr length ms': state.envelopeLenMs,
    }),
    [state.bypass, state.envelope, state.envelopeLenMs, state.params]
  );

  return (
    <ControlPanel
      className='filter-control-panel'
      style={{ width: 400 }}
      title='FILTER'
      settings={settings}
      state={controlPanelState}
      onChange={(key: string, val: any) => {
        const newState = handleFilterChange(filters, adsrs, state, key, val);
        onChange(newState.params, newState.envelope, newState.bypass, newState.envelopeLenMs);
        setState(newState);
      }}
    />
  );
};

export default FilterConfig;
