import React, { useMemo, useState } from 'react';
import ControlPanel from 'react-control-panel';
import * as R from 'ramda';

import type { Adsr } from 'src/graphEditor/nodes/CustomAudio/FMSynth/FMSynth';
import { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import type { FilterParams } from 'src/redux/modules/synthDesigner';
import { ADSR2Module } from 'src/synthDesigner/ADSRModule';
import {
  AbstractFilterModule,
  buildAbstractFilterModule,
  FilterCSNs,
} from 'src/synthDesigner/biquadFilterModule';
import { FilterType, getSettingsForFilterType } from 'src/synthDesigner/filterHelpers';
import { msToSamples, samplesToMs } from 'src/util';

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
  adsrs: ADSR2Module[],
  state: { params: FilterParams; envelope: Adsr; bypass: boolean },
  key: string,
  val: any
) => {
  const newState = { ...state, envelope: { ...state.envelope }, params: { ...state.params } };
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
      newState.envelope.lenSamples = msToSamples(val);
      break;
    }
    case 'adsr': {
      adsrs.forEach(adsr => adsr.setState(val));
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
    envelope: Adsr;
    bypass: boolean;
  };
  filters: FilterContainer[];
  adsrs: ADSR2Module[];
  onChange: (params: FilterParams, envelope: Adsr, bypass: boolean) => void;
}> = ({ initialState, filters, adsrs, onChange }) => {
  const [state, setState] = useState(initialState);

  const settings = useMemo(
    () =>
      getSettingsForFilterType(state.params.type).map(s => {
        delete (s as any).initial;
        return s;
      }),
    [state.params.type]
  );
  const controlPanelState = useMemo(
    () => ({
      ...state.params,
      adsr: { ...state.envelope, outputRange: [0, 44_100 / 2] },
      bypass: state.bypass,
      'adsr length ms': R.clamp(0, 10000, samplesToMs(state.envelope.lenSamples)),
    }),
    [state.bypass, state.envelope, state.params]
  );

  return (
    <ControlPanel
      className='filter-control-panel'
      style={{ width: 700 }}
      title='FILTER'
      settings={settings}
      state={controlPanelState}
      onChange={(key: string, val: any) => {
        const newState = handleFilterChange(filters, adsrs, state, key, val);
        onChange(newState.params, newState.envelope, newState.bypass);
        setState(newState);
      }}
    />
  );
};

export default FilterConfig;
