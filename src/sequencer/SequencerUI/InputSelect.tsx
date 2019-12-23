import React from 'react';
import { connect } from 'react-redux';
import { Option } from 'funfix-core';
import { UnimplementedError } from 'ameo-utils';

import { SequencerReduxState, VoiceTarget, SequencerReduxInfra } from '../redux';
import { SampleDescriptor } from 'src/sampleLibrary';

const SynthInput: React.FC<{
  voiceTarget: Extract<VoiceTarget, { type: 'midi' }>;
}> = ({ voiceTarget }) => <></>;

const mapSampleInputStateToProps = (
  state: { sequencer: SequencerReduxState },
  { voiceTarget: { sampleIx } }: { voiceTarget: Extract<VoiceTarget, { type: 'sample' }> }
) => ({
  sampleOpt: Option.of(sampleIx).map(sampleIx => state.sequencer.sampleBank[sampleIx]),
});

const selectSample = (): Promise<SampleDescriptor> => {
  throw new UnimplementedError(); // TODO
};

const SampleInputInner: React.FC<{
  voiceTarget: Extract<VoiceTarget, { type: 'sample' }>;
} & ReturnType<typeof mapSampleInputStateToProps>> = ({ voiceTarget: { sampleIx }, sampleOpt }) => (
  <div>
    Selected Sample: {sampleOpt.map(({ descriptor }) => descriptor.name).getOrElse('None')}
    <button
      onClick={async () => {
        const descriptor = await selectSample();
        // TODO
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
  midi: () => ({ type: 'midi', synthIx: null, frequency: 440.0 }),
  sample: () => ({ type: 'sample', sampleIx: null }),
};

const InputCompByTargetType: {
  [K in VoiceTarget['type']]: React.FC<{ voiceTarget: Extract<VoiceTarget, { type: K }> }>;
} = {
  midi: SynthInput,
  sample: SampleInput,
};

const VoiceInput: React.FC<{
  voiceIx: number;
  voiceTarget: VoiceTarget;
  actionCreators: SequencerReduxInfra['actionCreators'];
  dispatch: SequencerReduxInfra['dispatch'];
}> = ({ voiceIx, actionCreators, dispatch, voiceTarget }) => {
  const InputComp = InputCompByTargetType[voiceTarget.type];

  return (
    <div className='voice-input'>
      <select
        value={voiceTarget.type}
        onChange={evt =>
          dispatch(
            actionCreators.sequencer.SET_VOICE_TARGET(
              voiceIx,
              GetDefaultVoiceTargetByTargetType[evt.target.value]()
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

      <InputComp voiceTarget={voiceTarget as any} />
    </div>
  );
};

const mapStateToProps = (state: { sequencer: SequencerReduxState }) => ({
  voices: state.sequencer.voices,
});

const InputSelect: React.FC<{
  actionCreators: SequencerReduxInfra['actionCreators'];
  dispatch: SequencerReduxInfra['dispatch'];
} & ReturnType<typeof mapStateToProps>> = ({ dispatch, actionCreators, voices }) => {
  return (
    <div className='sequencer-input-select'>
      <h2>Input Mapping</h2>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {voices.map((voice, i) => (
          <VoiceInput
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
