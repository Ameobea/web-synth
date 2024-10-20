import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ControlPanel from 'react-control-panel';
import { shallowEqual } from 'react-redux';
import { createSelector } from 'reselect';

import { midiKeyboardCtxByStateKey } from 'src/midiKeyboard';
import { MidiKeyboard } from 'src/midiKeyboard/MidiKeyboard';
import type { GenericControlCb } from 'src/midiKeyboard/MidiKeyboardOutputMappingConfigurator';
import MidiKeyboardOutputMappingConfigurator from 'src/midiKeyboard/MidiKeyboardOutputMappingConfigurator';
import Loading from 'src/misc/Loading';
import { actionCreators, dispatch, useSelector, type ReduxStore } from 'src/redux';
import { MidiKeyboardMode } from 'src/redux/modules/midiKeyboard';
import { useIsVcHidden } from 'src/ViewContextManager/VcHideStatusRegistry';

const mkOctaveCountSelector = () =>
  createSelector(
    (state: ReduxStore, stateKey: string) => {
      const instanceState = state.midiKeyboard[stateKey];
      if (!instanceState) {
        throw new Error(
          `Rendered MIDI keyboard with state key ${stateKey} before Redux was populated for it`
        );
      }
      return instanceState;
    },
    instanceState => instanceState.octaveOffset
  );

const MODE_PICKER_SETTINGS = [
  { type: 'multibox', label: 'input source', names: ['computer keyboard', 'external midi device'] },
];

const MidiKeyboardModePicker: React.FC<{ stateKey: string }> = ({ stateKey }) => {
  const mode = useSelector((state: ReduxStore) => state.midiKeyboard[stateKey].mode);

  return (
    <ControlPanel
      style={{ width: 800 }}
      settings={MODE_PICKER_SETTINGS}
      state={{
        'input source': mode === MidiKeyboardMode.MidiInput ? [false, true] : [true, false],
      }}
      onChange={(_key: string, val: any) => {
        const newMode =
          mode === MidiKeyboardMode.MidiInput && (val[0] || !val[1])
            ? MidiKeyboardMode.ComputerKeyboard
            : MidiKeyboardMode.MidiInput;

        dispatch(actionCreators.midiKeyboard.SET_MIDI_INPUT_MODE(stateKey, newMode));
      }}
    />
  );
};

export interface MidiKeyboardVCProps {
  stateKey: string;
  registerGenericControlCb: (cb: GenericControlCb) => void;
  deregisterGenericControlCb: (cb: GenericControlCb) => void;
}

/**
 * the component that is mounted to render the view context containing the inner `MidiKeyboard` component
 */
export const MidiKeyboardVC: React.FC<MidiKeyboardVCProps> = ({
  stateKey,
  registerGenericControlCb,
  deregisterGenericControlCb,
}) => {
  const octaveCountSelector = useMemo(() => mkOctaveCountSelector(), []);
  const { octaveOffset, mode, midiInput, midiInputName } = useSelector(
    (state: ReduxStore) => ({
      octaveOffset: octaveCountSelector(state, stateKey),
      mode: state.midiKeyboard[stateKey].mode,
      midiInput: state.midiKeyboard[stateKey].midiInput,
      midiInputName: state.midiKeyboard[stateKey].midiInputName,
    }),
    shallowEqual
  );
  const [midiInputNames, setMidiInputNames] = useState<string[]>([]);
  useEffect(() => {
    midiInput?.getMidiInputNames().then(inputNames => setMidiInputNames(['', ...inputNames]));
  }, [midiInput]);
  const midiInputSettings = useMemo(
    () => [
      { type: 'select', label: 'midi input device', options: midiInputNames },
      {
        type: 'button',
        label: 'refresh device list',
        action: () =>
          midiInput?.getMidiInputNames().then(inputNames => setMidiInputNames(['', ...inputNames])),
      },
    ],
    [midiInput, midiInputNames]
  );

  const midiNode = midiKeyboardCtxByStateKey.get(stateKey)?.midiNode;
  const onOctaveOffsetChange = useCallback(
    (newOctaveOffset: number) =>
      dispatch(actionCreators.midiKeyboard.SET_OCTAVE_OFFSET(stateKey, newOctaveOffset)),
    [stateKey]
  );
  const onAttack = useCallback(
    (midiNumber: number) => midiNode?.onAttack(midiNumber, 255),
    [midiNode]
  );
  const onRelease = useCallback(
    (midiNumber: number) => midiNode?.onRelease(midiNumber, 255),
    [midiNode]
  );

  const vcId = stateKey.split('_')[1];
  const isHidden = useIsVcHidden(vcId);

  if (!midiNode) {
    return <Loading />;
  }

  if (mode === MidiKeyboardMode.MidiInput) {
    if (isHidden) {
      return null;
    }

    return (
      <div className='midi-keyboard-vc'>
        <MidiKeyboardModePicker stateKey={stateKey} />
        <ControlPanel
          title='midi input'
          style={{ width: 800 }}
          settings={midiInputSettings}
          state={{ 'midi input device': midiInputName ?? '' }}
          onChange={(_key: string, midiInputName: string) => {
            dispatch(actionCreators.midiKeyboard.SET_MIDI_INPUT_NAME(stateKey, midiInputName));
          }}
        />
        <MidiKeyboardOutputMappingConfigurator
          stateKey={stateKey}
          registerGenericControlCb={registerGenericControlCb}
          deregisterGenericControlCb={deregisterGenericControlCb}
        />
      </div>
    );
  }

  return (
    <div className='midi-keyboard-vc'>
      <MidiKeyboardModePicker stateKey={stateKey} />
      <MidiKeyboard
        octaveOffset={octaveOffset}
        onOctaveOffsetChange={onOctaveOffsetChange}
        onAttack={onAttack}
        onRelease={onRelease}
        isHidden={isHidden}
      />
    </div>
  );
};

export const mkMidiKeyboardSmallView = (
  stateKey: string,
  registerGenericControlCb: (cb: GenericControlCb) => void,
  deregisterGenericControlCb: (cb: GenericControlCb) => void
) => {
  const MidiKeyboardSmallView: React.FC = () => (
    <MidiKeyboardOutputMappingConfigurator
      stateKey={stateKey}
      registerGenericControlCb={registerGenericControlCb}
      deregisterGenericControlCb={deregisterGenericControlCb}
    />
  );
  return MidiKeyboardSmallView;
};
