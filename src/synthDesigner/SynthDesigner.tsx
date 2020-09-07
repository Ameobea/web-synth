import React, { useEffect, useRef } from 'react';
import { connect, Provider } from 'react-redux';
import * as R from 'ramda';
import ControlPanel from 'react-control-panel';
import { PropTypesOf } from 'ameo-utils';

import { EffectType } from 'src/redux/modules/synthDesigner';
import { buildEffect } from 'src/synthDesigner/effects';
import { SpectrumVisualization } from 'src/visualizations/spectrum';
import {
  SynthDesignerReduxStore,
  getReduxInfra,
  get_synth_designer_audio_connectables,
  SynthDesignerReduxInfra,
} from 'src/synthDesigner';
import { ReduxStore, store } from 'src/redux';
import { voicePresetIdsSelector } from 'src/redux/modules/presets';
import { updateConnectables } from 'src/patchNetwork';
import SynthModuleComp from './SynthModule';
import EffectModuleComp from './effects/Effect';
import './SynthDesigner.scss';

declare class WavyJones extends AnalyserNode {
  public lineColor: string;
  public lineThickness: number;
  constructor(ctx: AudioContext, nodeId: string, updateIntervalMs?: number);
}

const mapAddModuleControlsStateToProps = (state: ReduxStore) => ({
  voicePresets: state.presets.voicePresets,
  voicePresetIds: voicePresetIdsSelector(state),
});

const AddModuleControlsInner: React.FC<{
  stateKey: string;
  synthDesignerActionCreators: SynthDesignerReduxInfra['actionCreators'];
  synthDesignerDispatch: SynthDesignerReduxInfra['dispatch'];
} & ReturnType<typeof mapAddModuleControlsStateToProps>> = ({
  stateKey,
  voicePresets,
  voicePresetIds,
  synthDesignerActionCreators,
  synthDesignerDispatch,
}) => {
  const controlPanelContext = useRef<{ [label: string]: any } | undefined>();

  return (
    <ControlPanel
      contextCb={(ctx: { [label: string]: any }) => {
        controlPanelContext.current = ctx;
      }}
      settings={[
        {
          label: 'preset',
          type: 'select',
          options: { blank: 'blank', ...voicePresetIds },
          initial: 'blank',
        },
        {
          label: 'add synth module',
          type: 'button',
          action: () => {
            if (!controlPanelContext.current) {
              throw new Error('Control panel context not set!');
            }

            const selectedVoicePresetId: number = controlPanelContext.current['preset'];
            const selectedVoicePreset = voicePresets[selectedVoicePresetId];
            // TODO

            const vcId = stateKey.split('_')[1]!;
            synthDesignerDispatch(synthDesignerActionCreators.synthDesigner.ADD_SYNTH_MODULE());
            const newConnectables = get_synth_designer_audio_connectables(stateKey);
            updateConnectables(vcId, newConnectables);
          },
        },
      ]}
    />
  );
};

const AddModuleControlsUnwrapped = connect(mapAddModuleControlsStateToProps)(
  AddModuleControlsInner
);
const AddModuleControls: React.FC<Omit<
  PropTypesOf<typeof AddModuleControlsInner>,
  keyof ReturnType<typeof mapAddModuleControlsStateToProps>
>> = ({ ...props }) => (
  <Provider store={store}>
    <AddModuleControlsUnwrapped {...props} />
  </Provider>
);

const mapStateToProps = ({ synthDesigner }: SynthDesignerReduxStore) => ({
  synthDesignerState: synthDesigner,
});

const SynthDesigner: React.FC<{ stateKey: string } & ReturnType<typeof mapStateToProps>> = ({
  synthDesignerState,
  stateKey,
}) => {
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
                stateKey={stateKey}
              />
            ))}

            <div className='add-effect'>
              <select
                value={synth.selectedEffectType}
                onChange={evt =>
                  dispatch(
                    actionCreators.synthDesigner.SET_SELECTED_EFFECT_TYPE(
                      i,
                      evt.target.value as EffectType
                    )
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

        <AddModuleControls
          stateKey={stateKey}
          synthDesignerActionCreators={actionCreators}
          synthDesignerDispatch={dispatch}
        />
      </div>

      <button
        onMouseDown={() => dispatch(actionCreators.synthDesigner.GATE(440, 0))}
        onMouseUp={() => dispatch(actionCreators.synthDesigner.UNGATE(0))}
      >
        Gate
      </button>

      <div id='oscilloscope' ref={oscilloscopeNode}></div>

      {synthDesignerState.spectrumNode ? (
        <SpectrumVisualization
          paused={synthDesignerState.isHidden}
          analyzerNode={synthDesignerState.spectrumNode}
        />
      ) : null}
    </>
  );
};

export default connect(mapStateToProps)(SynthDesigner);
