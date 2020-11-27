import React from 'react';
import { connect } from 'react-redux';
import * as R from 'ramda';
import { Option } from 'funfix-core';

import { getSample } from 'src/sampleLibrary';
import { updateConnectables } from 'src/patchNetwork';
import { get_sequencer_audio_connectables } from 'src/sequencer/sequencer';
import { SequencerReduxState, VoiceTarget, SequencerReduxInfra } from '../redux';
import { selectSample } from 'src/sampleLibrary/SampleLibraryUI/SelectSample';

const mapSynthInputStateToProps = (state: { sequencer: SequencerReduxState }) => ({
  midiOutputCount: state.sequencer.midiOutputs.length,
});

interface InputCompCommonProps<T> extends SequencerReduxInfra {
  voiceIx: number;
  vcId: string;
  voiceTarget: Extract<VoiceTarget, { type: T }>;
}

const SynthInputInner: React.FC<
  InputCompCommonProps<'midi'> & ReturnType<typeof mapSynthInputStateToProps>
> = ({ voiceIx, voiceTarget, vcId, dispatch, actionCreators, midiOutputCount }) => (
  <div>
    <div>
      <select
        onChange={evt =>
          dispatch(
            actionCreators.sequencer.SET_VOICE_TARGET(voiceIx, {
              ...voiceTarget,
              synthIx: Option.of(evt.target.value)
                .flatMap(n => Option.of(n === 'none' ? null : +n))
                .orNull(),
            })
          )
        }
        value={Option.of(voiceTarget.synthIx).getOrElse('none')}
      >
        {R.times(
          i =>
            i === 0 ? (
              <option key='none' value='none'>
                None
              </option>
            ) : (
              <option key={i} value={i - 1}>
                {i}
              </option>
            ),
          midiOutputCount + 1
        )}
      </select>

      <button
        onClick={() => {
          dispatch(actionCreators.sequencer.ADD_MIDI_OUTPUT());
          updateConnectables(vcId, get_sequencer_audio_connectables(vcId));
        }}
      >
        Add MIDI Output
      </button>
    </div>
    <div>
      <button onClick={() => dispatch(actionCreators.sequencer.TOGGLE_EDIT_MODE(voiceIx))}>
        {voiceTarget.editState ? 'exit edit mode' : 'enter edit mode'}
      </button>
    </div>
  </div>
);

const SynthInput = connect(mapSynthInputStateToProps)(SynthInputInner);

const mapSampleInputStateToProps = (
  state: { sequencer: SequencerReduxState },
  { voiceIx }: { voiceIx: number }
) => ({
  sampleOpt:
    typeof state.sequencer.sampleBank === 'string'
      ? ('LOADING' as const)
      : Option.of(state.sequencer.sampleBank[voiceIx]),
});

const SampleInputInner: React.FC<
  InputCompCommonProps<'sample'> & ReturnType<typeof mapSampleInputStateToProps>
> = ({ sampleOpt, voiceIx, dispatch, actionCreators }) => (
  <div>
    Selected Sample:{' '}
    {sampleOpt === 'LOADING'
      ? 'Loading...'
      : sampleOpt.map(({ descriptor }) => descriptor.name).getOrElse('None')}
    <button
      onClick={async () => {
        const descriptor = await selectSample();
        const sampleData = await getSample(descriptor);
        dispatch(actionCreators.sequencer.ADD_SAMPLE(voiceIx, descriptor, sampleData));
        dispatch(actionCreators.sequencer.SET_VOICE_TARGET(voiceIx, { type: 'sample' }));
      }}
    >
      Pick Sample
    </button>
  </div>
);

const SampleInput = connect(mapSampleInputStateToProps)(SampleInputInner);

const mapGateInputStateToProps = (state: { sequencer: SequencerReduxState }) => ({
  gateOutputCount: state.sequencer.gateOutputs.length,
});

const GateInputInner: React.FC<
  {
    actionCreators: SequencerReduxInfra['actionCreators'];
    dispatch: SequencerReduxInfra['dispatch'];
  } & ReturnType<typeof mapGateInputStateToProps>
> = ({ actionCreators, dispatch, gateOutputCount }) => {
  return (
    <div>
      <select>
        <option value='none'>None</option>
        {R.times(
          i => (
            <option key={i} value={i}>{`Gate Output ${i + 1}`}</option>
          ),
          gateOutputCount
        )}
      </select>
      <button onClick={() => dispatch(actionCreators.sequencer.ADD_GATE_OUTPUT())}>
        Add Gate Output
      </button>
    </div>
  );
};

const GateInput = connect(mapGateInputStateToProps)(GateInputInner);

const AllVoiceTargetTypes: VoiceTarget['type'][] = ['midi', 'sample', 'gate'];

const GetDefaultVoiceTargetByTargetType: {
  [K in VoiceTarget['type']]: () => Extract<VoiceTarget, { type: K }>;
} = {
  midi: () => ({ type: 'midi', synthIx: null, note: 40 }),
  sample: () => ({ type: 'sample', sampleIx: null }),
  gate: () => ({ type: 'gate', gateIx: null }),
};

const InputCompByTargetType: {
  [K in VoiceTarget['type']]: React.FC<InputCompCommonProps<K>>;
} = {
  midi: SynthInput,
  sample: SampleInput,
  gate: GateInput,
};

const VoiceInput: React.FC<{
  vcId: string;
  voiceIx: number;
  voiceTarget: VoiceTarget;
  actionCreators: SequencerReduxInfra['actionCreators'];
  dispatch: SequencerReduxInfra['dispatch'];
}> = ({ vcId, voiceIx, actionCreators, dispatch, voiceTarget }) => {
  const InputComp = InputCompByTargetType[voiceTarget.type];

  return (
    <div className='voice-input'>
      <select
        value={voiceTarget.type}
        onChange={evt =>
          dispatch(
            actionCreators.sequencer.SET_VOICE_TARGET(
              voiceIx,
              GetDefaultVoiceTargetByTargetType[
                evt.target.value as keyof typeof GetDefaultVoiceTargetByTargetType
              ]()
            )
          )
        }
      >
        {AllVoiceTargetTypes.map(targetType => (
          <option key={targetType} value={targetType}>
            {targetType}
          </option>
        ))}
      </select>

      <InputComp
        voiceIx={voiceIx}
        voiceTarget={voiceTarget as any}
        actionCreators={actionCreators}
        dispatch={dispatch}
        vcId={vcId}
      />
    </div>
  );
};

const InputSelect: React.FC<
  { vcId: string } & Pick<SequencerReduxInfra, 'actionCreators' | 'dispatch' | 'useSelector'>
> = ({ vcId, dispatch, actionCreators, useSelector }) => {
  const { voice, currentEditingVoiceIx } = useSelector(state => ({
    currentEditingVoiceIx: state.sequencer.currentEditingVoiceIx,
    voice: state.sequencer.voices[state.sequencer.currentEditingVoiceIx],
  }));

  return (
    <div className='sequencer-input-select'>
      <h2>Input Mapping</h2>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <VoiceInput
          vcId={vcId}
          dispatch={dispatch}
          actionCreators={actionCreators}
          voiceIx={currentEditingVoiceIx}
          voiceTarget={voice}
        />
      </div>
    </div>
  );
};

export default InputSelect;
