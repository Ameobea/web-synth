import React, { useEffect, useRef, useState, useMemo } from 'react';
import { connect } from 'react-redux';
import * as R from 'ramda';
import ControlPanel from 'react-control-panel';

import { EffectType } from 'src/redux/modules/synthDesigner';
import SynthModuleComp from './SynthModule';
import EffectModuleComp from './effects/Effect';
import './SynthDesigner.scss';
import { buildEffect } from 'src/synthDesigner/effects';
import { SpectrumVisualization } from 'src/visualizations/spectrum';
import {
  SynthDesignerReduxStore,
  getReduxInfra,
  get_synth_designer_audio_connectables,
} from 'src/synthDesigner';
import { updateConnectables } from 'src/patchNetwork';
import { BACKEND_BASE_URL } from 'src/conf';
import { SynthPreset, SynthPresetEntry, SynthVoicePresetEntry } from 'src/synthDesigner/preset';
import { useOnce } from 'ameo-utils/dist/util/react';

declare class WavyJones extends AnalyserNode {
  public lineColor: string;
  public lineThickness: number;
  constructor(ctx: AudioContext, nodeId: string, updateIntervalMs?: number);
}

const fetchSynthPresets = async (): Promise<SynthPresetEntry[]> =>
  fetch(`${BACKEND_BASE_URL}/synth_presets`).then(res => res.json());

const fetchSynthVoicePresets = async (): Promise<SynthVoicePresetEntry[]> =>
  fetch(`${BACKEND_BASE_URL}/synth_voice_presets`).then(res => res.json());

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
  const [presets, setPresets] = useState([] as SynthPresetEntry[]);
  const [voicePresets, setVoicePresets] = useState([] as SynthVoicePresetEntry[]);
  const controlPanelContext = useRef<{ [label: string]: any } | undefined>();
  useOnce(async () => {
    for (let i = 0; i < 3; i++) {
      try {
        const presets = await fetchSynthPresets();
        setPresets(presets);
        return;
      } catch (err) {
        console.warn(`Failed to fetch synth presets; attempts: ${i + 1}`);
      }
    }
    console.error('Failed to fetch synth presets in 3 attempts');
  });

  const presetIds: { [id: number]: string } = useMemo(
    () => Object.entries(presets).reduce((acc, [id, val]) => ({ ...acc, [val.title]: id }), {}),
    [presets]
  );

  useOnce(async () => {
    for (let i = 0; i < 3; i++) {
      try {
        const voicePresets = await fetchSynthVoicePresets();
        setVoicePresets(voicePresets);
        return;
      } catch (err) {
        console.warn(`Failed to fetch synth voice presets; attempts: ${i + 1}`);
      }
    }
    console.error('Failed to fetch synth voice presets in 3 attempts');
  });

  const voicePresetIds: { [id: number]: string } = useMemo(
    () =>
      Object.entries(voicePresets).reduce((acc, [id, val]) => ({ ...acc, [val.title]: id }), {}),
    [presets]
  );

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

        <ControlPanel
          contextCb={(ctx: { [label: string]: any }) => {
            controlPanelContext.current = ctx;
          }}
          settings={[
            {
              label: 'preset',
              type: 'select',
              options: { blank: 'blank', ...presetIds },
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
                dispatch(actionCreators.synthDesigner.ADD_SYNTH_MODULE());
                const newConnectables = get_synth_designer_audio_connectables(stateKey);
                updateConnectables(vcId, newConnectables);
              },
            },
          ]}
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
        <SpectrumVisualization analyzerNode={synthDesignerState.spectrumNode} />
      ) : null}
    </>
  );
};

export default connect(mapStateToProps)(SynthDesigner);
