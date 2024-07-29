import React, { useState } from 'react';
import { shallowEqual, useDispatch, useSelector } from 'react-redux';

import './MidiKeyboardOutputMappingConfigurator.css';

import { RangeInput } from 'src/graphEditor/nodes/CustomAudio/ScaleAndShift/RangeInput';
import {
  get_midi_keyboard_audio_connectables,
  type MappedOutput,
  midiKeyboardCtxByStateKey,
} from 'src/midiKeyboard';
import type { ConnectableDescriptor } from 'src/patchNetwork';
import { connect, updateConnectables } from 'src/patchNetwork/interface';
import { actionCreators, getState, type ReduxStore } from 'src/redux';
import type { MidiKeyboardMappedOutputDescriptor } from 'src/redux/modules/midiKeyboard';

const OutputMappingScaleAndShiftControls: React.FC<{
  descriptor: MidiKeyboardMappedOutputDescriptor;
  onChange: (scale: number, shift: number, logScale: boolean) => void;
}> = ({ descriptor, onChange }) => (
  <div className='output-mapping-scale-and-shift-controls'>
    <div className='top'>
      <div className='title'>Output Range</div>
      <div className='log-range-checkbox-wrapper'>
        <div className='log-title'>log scale</div>
        <input
          type='checkbox'
          checked={descriptor.logScale}
          onChange={() => onChange(descriptor.scale, descriptor.shift, !descriptor.logScale)}
          className='log-range-checkbox'
        />
      </div>
    </div>
    <RangeInput
      containerStyle={{ display: 'flex', flexDirection: 'row', width: 220 }}
      inputStyle={{ width: 100 }}
      value={
        [
          0 * descriptor.scale + descriptor.shift,
          127 * descriptor.scale + descriptor.shift,
        ] as const
      }
      onChange={newRange => {
        const range = newRange[1] - newRange[0];
        const scale = range / 127;
        const shift = newRange[0];
        onChange(scale, shift, descriptor.logScale);
      }}
    />
  </div>
);

interface OutputMappingRowProps {
  stateKey: string;
  outputIx: number;
  output: MappedOutput;
  descriptor: MidiKeyboardMappedOutputDescriptor;
  deleteMapping: () => void;
}

const OutputMappingRow: React.FC<OutputMappingRowProps> = ({
  stateKey,
  outputIx,
  output,
  descriptor,
  deleteMapping,
}) => {
  const dispatch = useDispatch();
  const [editingName, setEditingName] = useState(output.name);
  const nameRef = React.useRef<HTMLInputElement>(null);

  return (
    <div className='output-mapping-row'>
      <button className='delete-mapping-button' title='Delete Mapping' onClick={deleteMapping}>
        &times;
      </button>
      <div title='MIDI control index' className='midi-control-index'>
        {descriptor.controlIndex}
      </div>
      <div title='Output connectable name' className='output-connectable-name'>
        <input
          ref={nameRef}
          type='text'
          value={editingName}
          onChange={evt => setEditingName(evt.target.value)}
          onKeyDown={evt => {
            if (evt.key === 'Enter') {
              if (editingName === output.name) {
                return;
              }
              const ctx = midiKeyboardCtxByStateKey.get(stateKey)!;
              const vcId = stateKey.split('_')[1]!;

              // Validate that name is unique
              const allNames = ctx.mappedOutputs.map(o => o.name);
              if (allNames.includes(editingName)) {
                alert('Output name must be unique');
                return;
              }

              // Re-connect everything previously connected the old name to the new name
              const oldName = ctx.mappedOutputs[outputIx].name;
              const allConnectedDestinations =
                getState().viewContextManager.patchNetwork.connections.filter(
                  ([from, _to]) => from.vcId === vcId && from.name === oldName
                );

              // Store in Redux + update connectables. This disconnects everything connected to the old connectable.
              ctx.mappedOutputs[outputIx].name = editingName;
              updateConnectables(vcId, get_midi_keyboard_audio_connectables(stateKey));

              const newFromDescriptor: ConnectableDescriptor = { vcId, name: editingName };
              allConnectedDestinations.forEach(([_from, to]) => {
                connect(newFromDescriptor, to);
              });

              nameRef.current!.blur();
            }
          }}
        />
      </div>
      <OutputMappingScaleAndShiftControls
        descriptor={descriptor}
        onChange={(scale, shift, logScale) =>
          dispatch(
            actionCreators.midiKeyboard.SET_MAPPED_OUTPUT_PARAMS(
              stateKey,
              outputIx,
              scale,
              shift,
              logScale
            )
          )
        }
      />
    </div>
  );
};

const AddOutputMappingPrompt: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <div className='add-output-mapping-prompt'>
    <button onClick={onClick}>Add Output Mapping</button>
  </div>
);

const MIDILearnPrompt: React.FC<{ onCancel: () => void }> = ({ onCancel }) => (
  <div className='midi-learn-prompt'>
    Listening for MIDI control messages....
    <br />
    Turn the knob/press the button/etc. to learn the mapping.
    <button onClick={onCancel}>Cancel</button>
  </div>
);

export type GenericControlCb = (controlIndex: number, controlValue: number) => void;

type MidiLearnState = { type: 'notLearning' } | { type: 'learning'; cb: GenericControlCb };

const MidiKeyboardOutputMappingConfigurator: React.FC<{
  stateKey: string;
  registerGenericControlCb: (cb: GenericControlCb) => void;
  deregisterGenericControlCb: (cb: GenericControlCb) => void;
}> = ({ stateKey, registerGenericControlCb, deregisterGenericControlCb }) => {
  const [midiLearnState, setMidiLearnState] = useState<MidiLearnState>({ type: 'notLearning' });
  const dispatch = useDispatch();
  const mappedOutputs = useSelector(
    (state: ReduxStore) => state.midiKeyboard[stateKey].mappedOutputs,
    shallowEqual
  );
  const mutableCtx = midiKeyboardCtxByStateKey.get(stateKey);
  if (!mutableCtx) {
    return null;
  }

  return (
    <div className='midi-keyboard-output-mapping-configurator'>
      {mappedOutputs.map((descriptor, outputIx) => (
        <OutputMappingRow
          stateKey={stateKey}
          key={mutableCtx.mappedOutputs[outputIx].name}
          outputIx={outputIx}
          descriptor={descriptor}
          output={mutableCtx.mappedOutputs[outputIx]}
          deleteMapping={() =>
            dispatch(actionCreators.midiKeyboard.REMOVE_MAPPED_OUTPUT(stateKey, outputIx))
          }
        />
      ))}
      {midiLearnState.type === 'learning' ? (
        <MIDILearnPrompt
          onCancel={() => {
            deregisterGenericControlCb(midiLearnState.cb);
            setMidiLearnState({ type: 'notLearning' });
          }}
        />
      ) : (
        <AddOutputMappingPrompt
          onClick={() => {
            const cb: GenericControlCb = (controlIndex: number, _controlValue: number) => {
              console.log(
                `Learning MIDI generic control mapping for control index=${controlIndex}`
              );

              dispatch(actionCreators.midiKeyboard.ADD_NEW_MAPPED_OUTPUT(stateKey, controlIndex));
              deregisterGenericControlCb(cb);
              setMidiLearnState({ type: 'notLearning' });
            };

            registerGenericControlCb(cb);
            setMidiLearnState({ type: 'learning', cb });
          }}
        />
      )}
    </div>
  );
};

export default MidiKeyboardOutputMappingConfigurator;
