import React from 'react';
import { connect } from 'react-redux';
import * as R from 'ramda';
import { Option } from 'funfix-core';
import { UnimplementedError, UnreachableException } from 'ameo-utils';

import { SampleDescriptor } from 'src/sampleLibrary';
import { updateConnectables } from 'src/patchNetwork';
import { get_sequencer_audio_connectables } from 'src/sequencer/sequencer';
import { SequencerReduxState, VoiceTarget, SequencerReduxInfra } from '../redux';

const mapSynthInputStateToProps = (state: { sequencer: SequencerReduxState }) => ({
  midiOutputCount: state.sequencer.midiOutputs.length,
});

interface InputCompCommonProps<T> {
  voiceIx: number;
  vcId: string;
  voiceTarget: Extract<VoiceTarget, { type: T }>;
  actionCreators: SequencerReduxInfra['actionCreators'];
  dispatch: SequencerReduxInfra['dispatch'];
}

const SynthInputInner: React.FC<InputCompCommonProps<'midi'> &
  ReturnType<typeof mapSynthInputStateToProps>> = ({
  voiceIx,
  voiceTarget,
  vcId,
  dispatch,
  actionCreators,
  midiOutputCount,
}) => (
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
    >
      {R.times(
        i =>
          i === 0 ? (
            <option key='none' value='none'>
              None
            </option>
          ) : (
            <option key={i} value={i}>
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
);

const SynthInput = connect(mapSynthInputStateToProps)(SynthInputInner);

const mapSampleInputStateToProps = (
  state: { sequencer: SequencerReduxState },
  { voiceTarget: { sampleIx } }: { voiceTarget: Extract<VoiceTarget, { type: 'sample' }> }
) => ({
  sampleOpt: Option.of(sampleIx).flatMap(sampleIx =>
    Option.of(state.sequencer.sampleBank[sampleIx])
  ),
});

const selectSample = (): Promise<SampleDescriptor> => {
  throw new UnimplementedError(); // TODO
};

const SampleInputInner: React.FC<InputCompCommonProps<'sample'> &
  ReturnType<typeof mapSampleInputStateToProps>> = ({ voiceTarget: { sampleIx }, sampleOpt }) => (
  <div>
    Selected Sample: {sampleOpt.map(({ descriptor }) => descriptor.name).getOrElse('None')}
    <button
      onClick={async () => {
        const descriptor = await selectSample();
        throw new UnreachableException(); // TODO
      }}
    >
      Pick Sample
    </button>
  </div>
);

const SampleInput = connect(mapSampleInputStateToProps)(SampleInputInner);

const AllVoiceTargetTypes: VoiceTarget['type'][] = ['midi', 'sample'];

const GetDefaultVoiceTargetByTargetType: {
  [K in VoiceTarget['type']]: () => Extract<VoiceTarget, { type: K }>;
} = {
  midi: () => ({ type: 'midi', synthIx: null, note: 40 }),
  sample: () => ({ type: 'sample', sampleIx: null }),
};

const InputCompByTargetType: {
  [K in VoiceTarget['type']]: React.FC<InputCompCommonProps<K>>;
} = {
  midi: SynthInput,
  sample: SampleInput,
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

const mapStateToProps = (state: { sequencer: SequencerReduxState }) => ({
  voices: state.sequencer.voices,
});

const InputSelect: React.FC<{
  vcId: string;
  actionCreators: SequencerReduxInfra['actionCreators'];
  dispatch: SequencerReduxInfra['dispatch'];
} & ReturnType<typeof mapStateToProps>> = ({ vcId, dispatch, actionCreators, voices }) => {
  return (
    <div className='sequencer-input-select'>
      <h2>Input Mapping</h2>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {voices.map((voice, i) => (
          <VoiceInput
            key={i}
            vcId={vcId}
            dispatch={dispatch}
            actionCreators={actionCreators}
            voiceIx={i}
            voiceTarget={voice}
          />
        ))}
      </div>
    </div>
  );
};

export default connect(mapStateToProps)(InputSelect);
