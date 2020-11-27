import React from 'react';
import { connect, useSelector } from 'react-redux';
import * as R from 'ramda';
import { Option } from 'funfix-core';

import { getSample } from 'src/sampleLibrary';
import { updateConnectables } from 'src/patchNetwork';
import { get_sequencer_audio_connectables } from 'src/sequencer/sequencer';
import { SequencerReduxState, VoiceTarget, SequencerReduxInfra } from '../redux';
import { selectSample } from 'src/sampleLibrary/SampleLibraryUI/SelectSample';

interface InputCompCommonProps<T> extends SequencerReduxInfra {
  voiceIx: number;
  vcId: string;
  voiceTarget: Extract<VoiceTarget, { type: T }>;
}

const SynthInput: React.FC<InputCompCommonProps<'midi'>> = ({
  voiceIx,
  voiceTarget,
  vcId,
  dispatch,
  actionCreators,
  useSelector,
}) => {
  const { midiOutputCount, isEditing } = useSelector(state => ({
    midiOutputCount: state.sequencer.midiOutputs.length,
    isEditing: state.sequencer.markEditState?.voiceIx === voiceIx,
  }));

  return (
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
          {isEditing ? 'exit edit mode' : 'enter edit mode'}
        </button>
      </div>
    </div>
  );
};

const SampleInput: React.FC<InputCompCommonProps<'sample'>> = ({
  voiceIx,
  dispatch,
  actionCreators,
  useSelector,
}) => {
  const sampleOpt = useSelector(state =>
    typeof state.sequencer.sampleBank === 'string'
      ? ('LOADING' as const)
      : Option.of(state.sequencer.sampleBank[voiceIx])
  );

  return (
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
};

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
  midi: () => ({ type: 'midi', synthIx: null, note: 40, editState: null }),
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

interface VoiceInputProps extends SequencerReduxInfra {
  vcId: string;
  voiceIx: number;
  voiceTarget: VoiceTarget;
}

const VoiceInput: React.FC<VoiceInputProps> = ({
  vcId,
  voiceIx,
  actionCreators,
  dispatch,
  voiceTarget,
}) => {
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
        useSelector={useSelector}
        vcId={vcId}
      />
    </div>
  );
};

interface InputSelectProps extends SequencerReduxInfra {
  vcId: string;
}

const InputSelect: React.FC<InputSelectProps> = ({ vcId, ...reduxInfra }) => {
  const { voice, currentEditingVoiceIx } = reduxInfra.useSelector(state => ({
    currentEditingVoiceIx: state.sequencer.currentEditingVoiceIx,
    voice: state.sequencer.voices[state.sequencer.currentEditingVoiceIx],
  }));

  return (
    <div className='sequencer-input-select'>
      <h2>Input Mapping</h2>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <VoiceInput
          vcId={vcId}
          voiceIx={currentEditingVoiceIx}
          voiceTarget={voice}
          {...reduxInfra}
        />
      </div>
    </div>
  );
};

export default InputSelect;
