import { Option } from 'funfix-core';
import * as R from 'ramda';
import React, { useMemo } from 'react';
import ControlPanel from 'react-control-panel';
import { shallowEqual, useSelector } from 'react-redux';

import { updateConnectables } from 'src/patchNetwork/interface';
import { getSample } from 'src/sampleLibrary';
import { selectSample } from 'src/sampleLibrary/SampleLibraryUI/SelectSample';
import { get_sequencer_audio_connectables } from 'src/sequencer/sequencer';
import { UnreachableError, truncateWithElipsis } from 'src/util';
import type { SequencerReduxInfra, VoiceTarget } from '../redux';

interface InputCompCommonProps<T> extends SequencerReduxInfra {
  voiceIx: number;
  vcId: string;
  voiceTarget: Extract<VoiceTarget, { type: T }>;
}

const AllVoiceTargetTypes: VoiceTarget['type'][] = ['midi', 'sample', 'gate'];

const buildInputTypeSetting = (voiceType: VoiceTarget['type']) => ({
  type: 'select',
  label: 'voice type',
  options: AllVoiceTargetTypes,
  initial: voiceType,
});

const mkInputOnChange =
  (
    props: Pick<InputCompCommonProps<any>, 'dispatch' | 'actionCreators' | 'voiceIx'>,
    extraOnChange?: (key: string, val: any, state: any) => void
  ) =>
  (key: string, val: any, state: any) => {
    if (key === 'voice type') {
      props.dispatch(
        props.actionCreators.sequencer.SET_VOICE_TARGET(
          props.voiceIx,
          GetDefaultVoiceTargetByTargetType[val as keyof typeof GetDefaultVoiceTargetByTargetType]()
        )
      );
      return;
    } else if (extraOnChange) {
      extraOnChange(key, val, state);
    }
  };

const SynthInput: React.FC<InputCompCommonProps<'midi'>> = ({
  voiceIx,
  voiceTarget,
  vcId,
  dispatch,
  actionCreators,
  useSelector,
}) => {
  const { midiOutputCount, isEditing } = useSelector(
    state => ({
      midiOutputCount: state.sequencer.midiOutputs.length,
      isEditing: state.sequencer.markEditState?.voiceIx === voiceIx,
    }),
    shallowEqual
  );

  const settings = useMemo(
    () => [
      buildInputTypeSetting('midi'),
      {
        label: 'midi output index',
        type: 'select',
        initial: Option.of(voiceTarget.synthIx).getOrElse('none'),
        options: {
          none: 'None',
          ...Object.fromEntries(R.times(i => i, midiOutputCount).map(i => [i, i])),
        },
      },
      {
        label: 'add midi output',
        type: 'button',
        action: () => {
          dispatch(actionCreators.sequencer.ADD_MIDI_OUTPUT());
          updateConnectables(vcId, get_sequencer_audio_connectables(vcId));
        },
      },
      {
        label: isEditing ? 'exit edit mode' : 'enter edit mode',
        type: 'button',
        action: () => dispatch(actionCreators.sequencer.TOGGLE_EDIT_MODE(voiceIx)),
      },
    ],
    [
      actionCreators.sequencer,
      dispatch,
      isEditing,
      midiOutputCount,
      vcId,
      voiceIx,
      voiceTarget.synthIx,
    ]
  );

  return (
    <ControlPanel
      style={{ width: 500 }}
      title='input mapping'
      settings={settings}
      onChange={mkInputOnChange({ dispatch, actionCreators, voiceIx }, (key, val, _state) => {
        if (key === 'midi output index') {
          dispatch(
            actionCreators.sequencer.SET_VOICE_TARGET(voiceIx, {
              ...voiceTarget,
              synthIx: Number.isNaN(+val) ? null : +val,
            })
          );
        }
      })}
    />
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

  const settings = useMemo(
    () => [
      buildInputTypeSetting('sample'),
      {
        type: 'button',
        label: 'pick sample',
        action: async () => {
          const descriptor = await selectSample();
          const sampleData = await getSample(descriptor);
          dispatch(actionCreators.sequencer.ADD_SAMPLE(voiceIx, descriptor, sampleData));
          dispatch(actionCreators.sequencer.SET_VOICE_TARGET(voiceIx, { type: 'sample', gain: 1 }));
        },
      },
    ],
    [actionCreators.sequencer, dispatch, voiceIx]
  );

  const selectedSampleName =
    sampleOpt === 'LOADING'
      ? 'Loading...'
      : sampleOpt.map(({ descriptor }) => descriptor.name).getOrElse('None');
  return (
    <ControlPanel
      style={{ width: 500 }}
      title={
        <div style={{ lineHeight: 0.98 }} title={selectedSampleName}>
          {truncateWithElipsis('Selected Sample: ' + selectedSampleName, 130)}
        </div>
      }
      settings={settings}
      onChange={mkInputOnChange({ voiceIx, dispatch, actionCreators })}
    />
  );
};

const GateInput: React.FC<InputCompCommonProps<'gate'>> = ({
  useSelector,
  actionCreators,
  dispatch,
  voiceIx,
}) => {
  const { gateOutputCount, voice } = useSelector(
    ({ sequencer: state }) => ({
      gateOutputCount: state.gateOutputs.length,
      voice: state.voices[voiceIx],
    }),
    shallowEqual
  );

  if (voice.type !== 'gate') {
    throw new UnreachableError();
  }

  const settings = useMemo(
    () => [
      buildInputTypeSetting('gate'),
      {
        type: 'text',
        label: 'default output value',
      },
      {
        type: 'checkbox',
        label: 'ungate by default',
      },
      {
        type: 'select',
        label: 'gate output index',
        options: {
          none: 'None',
          ...Object.fromEntries(R.times(i => i, gateOutputCount).map(i => [i, i])),
        },
      },
      {
        type: 'button',
        label: 'add gate output',
        action: () => dispatch(actionCreators.sequencer.ADD_GATE_OUTPUT()),
      },
    ],
    [actionCreators.sequencer, dispatch, gateOutputCount]
  );

  const state = useMemo(
    () => ({
      'voice type': voice.type,
      'gate output index': voice.gateIx,
      'ungate by default': voice.ungate,
      'default output value': voice.outputValue,
    }),
    [voice.gateIx, voice.outputValue, voice.type, voice.ungate]
  );

  return (
    <ControlPanel
      width={500}
      title='configure gate'
      settings={settings}
      state={state}
      onChange={mkInputOnChange({ voiceIx, dispatch, actionCreators }, (key, val, _state) => {
        switch (key) {
          case 'gate output index':
            dispatch(
              actionCreators.sequencer.SET_VOICE_TARGET(voiceIx, {
                ...voice,
                gateIx: Number.isNaN(+val) ? null : +val,
              })
            );
            break;
          case 'default output value':
            dispatch(
              actionCreators.sequencer.SET_VOICE_TARGET(voiceIx, {
                ...voice,
                outputValue: Number.isNaN(+val) ? voice.outputValue : +val,
              })
            );
            break;
          case 'ungate by default':
            dispatch(
              actionCreators.sequencer.SET_VOICE_TARGET(voiceIx, {
                ...voice,
                ungate: val,
              })
            );
            break;
          default:
            throw new UnreachableError('Unhandled setting label: ' + key);
        }
      })}
    />
  );
};

const GetDefaultVoiceTargetByTargetType: {
  [K in VoiceTarget['type']]: () => Extract<VoiceTarget, { type: K }>;
} = {
  midi: () => ({ type: 'midi', synthIx: null, note: 40, editState: null }),
  sample: () => ({ type: 'sample', sampleIx: null, gain: 1 }),
  gate: () => ({ type: 'gate', gateIx: null, outputValue: 1, ungate: true }),
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
  const { voice, currentEditingVoiceIx } = reduxInfra.useSelector(
    state => ({
      currentEditingVoiceIx: state.sequencer.currentEditingVoiceIx,
      voice: state.sequencer.voices[state.sequencer.currentEditingVoiceIx],
    }),
    shallowEqual
  );

  return (
    <div className='sequencer-input-select'>
      <VoiceInput vcId={vcId} voiceIx={currentEditingVoiceIx} voiceTarget={voice} {...reduxInfra} />
    </div>
  );
};

export default InputSelect;
