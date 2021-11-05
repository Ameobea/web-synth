import React, { useState } from 'react';
import { shallowEqual, useSelector } from 'react-redux';

import { MappedOutput, midiKeyboardCtxByStateKey } from 'src/midiKeyboard';
import type { ReduxStore } from 'src/redux';
import type { MidiKeyboardMappedOutputDescriptor } from 'src/redux/modules/midiKeyboard';
import './MidiKeyboardOutputMappingConfigurator.scss';

const OutputMappingScaleAndShiftControls: React.FC<{
  descriptor: MidiKeyboardMappedOutputDescriptor;
}> = ({ descriptor }) => <div className='output-mapping-scale-and-shift-controls'>TODO</div>;

interface OutputMappingRowProps {
  output: MappedOutput;
  descriptor: MidiKeyboardMappedOutputDescriptor;
}

const OutputMappingRow: React.FC<OutputMappingRowProps> = ({ output, descriptor }) => (
  <div className='output-mapping-row'>
    <div title='MIDI control index'>{descriptor.controlIndex}</div>
    <div title='Output connectable name'>{output.name}</div>
    <OutputMappingScaleAndShiftControls descriptor={descriptor} />
  </div>
);

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
          key={mutableCtx.mappedOutputs[outputIx].name}
          descriptor={descriptor}
          output={mutableCtx.mappedOutputs[outputIx]}
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

              // TODO
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
