import React, { useEffect, useRef } from 'react';
import { connect } from 'react-redux';
import { useOnce } from 'ameo-utils/util/react';
import * as R from 'ramda';

import { actionCreators, ReduxStore, dispatch } from 'src/redux';
import { SynthDesignerState, EffectType } from 'src/redux/modules/synthDesigner';
import SynthModuleComp from './SynthModule';
import EffectModuleComp from './effects/Effect';
import './SynthDesigner.scss';
import { buildEffect } from 'src/synthDesigner/effects';

declare class WavyJones extends AnalyserNode {
  public lineColor: string;
  public lineThickness: number;
  constructor(ctx: AudioContext, nodeId: string, updateIntervalMs?: number);
}

const mapStateToProps = ({ synthDesigner }: ReduxStore) => ({ synthDesignerState: synthDesigner });

const SynthDesigner: React.FC<
  {
    initialState?: SynthDesignerState | null;
  } & ReturnType<typeof mapStateToProps>
> = ({ initialState, synthDesignerState }) => {
  const oscilloscopeNode = useRef<HTMLDivElement | null>(null);
  const wavyJonesInstance = useRef<WavyJones | null>(null);

  useEffect(() => {
    if (
      !oscilloscopeNode.current ||
      wavyJonesInstance.current ||
      R.isEmpty(synthDesignerState.synths)
    ) {
      return;
    }

    wavyJonesInstance.current = new WavyJones(new AudioContext(), 'oscilloscope', 40);

    wavyJonesInstance.current.lineColor = '#FFF';
    wavyJonesInstance.current.lineThickness = 1.2;

    dispatch(actionCreators.synthDesigner.SET_WAVY_JONES_INSTANCE(wavyJonesInstance.current));
  });

  useOnce(() => {
    if (initialState) {
      dispatch(actionCreators.synthDesigner.SET_STATE(initialState));
    }
  });

  useEffect(() => {
    const downHandler = (evt: KeyboardEvent) => {
      if (['z', 'x'].includes(evt.key)) {
        dispatch(actionCreators.synthDesigner.GATE(440));
      }
    };
    const upHandler = (evt: KeyboardEvent) => {
      if (['z', 'x'].includes(evt.key)) {
        dispatch(actionCreators.synthDesigner.UNGATE());
      }
    };

    document.addEventListener('keydown', downHandler);
    document.addEventListener('keyup', upHandler);

    return () => {
      document.removeEventListener('keydown', downHandler);
      document.removeEventListener('keyup', upHandler);
    };
  });

  return (
    <>
      <div className='synth-designer'>
        {synthDesignerState.synths.map((synth, i) => (
          <SynthModuleComp key={i} synth={synth} index={i}>
            {synth.effects.map((effect, effectIx) => (
              <EffectModuleComp
                effectName={effect.effect.type}
                key={effectIx}
                synthIx={i}
                effectIx={effectIx}
                wetness={effect.wetness}
                isBypassed={effect.isBypassed}
                params={effect.params}
                effectSettings={effect.effect.node.getSettingDefs()}
              />
            ))}

            <div className='add-effect'>
              <select
                value={synth.selectedEffectType}
                onChange={evt =>
                  dispatch(
                    actionCreators.synthDesigner.SET_SELECTED_EFFECT_TYPE(i, evt.target
                      .value as EffectType)
                  )
                }
              >
                {Object.entries(EffectType).map(([key, val]) => (
                  <option key={val} value={val}>
                    {key}
                  </option>
                ))}
              </select>
              <button
                onClick={() => {
                  const { effect, params } = buildEffect(synth.selectedEffectType);
                  dispatch(actionCreators.synthDesigner.ADD_EFFECT(i, effect, params));
                }}
              >
                Add Effect
              </button>
            </div>
          </SynthModuleComp>
        ))}

        <button
          style={{ marginTop: 6 }}
          onClick={() => dispatch(actionCreators.synthDesigner.ADD_SYNTH_MODULE())}
        >
          Add Synth Module
        </button>
      </div>

      <div id='oscilloscope' ref={oscilloscopeNode}></div>

      <button
        onMouseDown={() => dispatch(actionCreators.synthDesigner.GATE(440))}
        onMouseUp={() => dispatch(actionCreators.synthDesigner.UNGATE())}
      >
        Gate
      </button>
    </>
  );
};

export default connect(mapStateToProps)(SynthDesigner);
