import React, { useEffect, useRef } from 'react';
import { connect } from 'react-redux';
import { useOnce } from 'ameo-utils/util/react';
import * as R from 'ramda';

import { SynthDesignerState, EffectType } from 'src/redux/modules/synthDesigner';
import SynthModuleComp from './SynthModule';
import EffectModuleComp from './effects/Effect';
import './SynthDesigner.scss';
import { buildEffect } from 'src/synthDesigner/effects';
import {
  SpectrumVisualization,
  initializeSpectrumVisualization,
} from 'src/visualizations/spectrum';
import {
  SynthDesignerReduxStore,
  getReduxInfra,
  get_synth_designer_audio_connectables,
} from 'src/synthDesigner';
import { updateConnectables } from 'src/patchNetwork';

declare class WavyJones extends AnalyserNode {
  public lineColor: string;
  public lineThickness: number;
  constructor(ctx: AudioContext, nodeId: string, updateIntervalMs?: number);
}

const mapStateToProps = ({ synthDesigner }: SynthDesignerReduxStore) => ({
  synthDesignerState: synthDesigner,
});

const SynthDesigner: React.FC<
  {
    initialState?: SynthDesignerState | null;
    stateKey: string;
  } & ReturnType<typeof mapStateToProps>
> = ({ initialState, synthDesignerState, stateKey }) => {
  const setSpectrumVizSettingsState = useRef<null | ReturnType<
    typeof initializeSpectrumVisualization
  >>(null);
  const oscilloscopeNode = useRef<HTMLDivElement | null>(null);
  const wavyJonesInstance = useRef<WavyJones | null>(null);

  const { dispatch, actionCreators } = getReduxInfra(stateKey);

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

  return (
    <>
      <div className='synth-designer'>
        {synthDesignerState.synths.map((synth, i) => (
          <SynthModuleComp key={i} synth={synth} index={i} stateKey={stateKey}>
            {synth.voices[0].effects.map((effect, effectIx) => (
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
          onClick={() => {
            const vcId = stateKey.split('_')[1]!;
            dispatch(actionCreators.synthDesigner.ADD_SYNTH_MODULE());
            const newConnectables = get_synth_designer_audio_connectables(stateKey);
            updateConnectables(vcId, newConnectables);
          }}
        >
          Add Synth Module
        </button>
      </div>

      <button
        onMouseDown={() => dispatch(actionCreators.synthDesigner.GATE(440, 0))}
        onMouseUp={() => dispatch(actionCreators.synthDesigner.UNGATE(0))}
      >
        Gate
      </button>

      <div id='oscilloscope' ref={oscilloscopeNode}></div>

      <SpectrumVisualization
        settingsState={{
          scalerFunction: 'linear',
          colorFunction: 'pink',
          intensityMultiplier: 2.2,
        }}
        setSettingsState={() => {
          /* TODO */
        }}
      />
      <canvas
        ref={ref => {
          if (!ref || synthDesignerState.spectrumNode) {
            return;
          }

          const analyzerNode = new AnalyserNode(new AudioContext());
          setSpectrumVizSettingsState.current = initializeSpectrumVisualization(analyzerNode, ref);

          dispatch(actionCreators.synthDesigner.SET_SPECTRUM_NODE(analyzerNode));
        }}
        width={1200}
        height={1024}
      />
    </>
  );
};

export default connect(mapStateToProps)(SynthDesigner);
