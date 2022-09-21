import * as R from 'ramda';
import React, { useCallback, useMemo, useState } from 'react';
import ControlPanel from 'react-control-panel';

import './GlobalVolume.scss';

import { getEngine } from 'src/util';

interface ViewContextDescriptor {
  name: string;
  displayName: string;
  description?: string;
}

export const ViewContextDescriptors: ViewContextDescriptor[] = [
  {
    name: 'midi_editor',
    displayName: 'MIDI Editor',
    description:
      'Fully-featured MIDI editor that can be used to create MIDI compositions that emit MIDI events.  Useful in combination with a module that accepts MIDI input such as the Synth Designer.',
  },
  {
    name: 'faust_editor',
    displayName: 'Code Editor',
    description:
      "Compile code written in either Faust or Soul into WebAssembly on the fly and load into the audio graph live.  Produces working UIs based off of the code's params, connectables for modulation, and preset saving/loading.",
  },
  { name: 'graph_editor', displayName: 'Graph Editor' },
  { name: 'composition_sharing', displayName: 'Composition Sharing' },
  { name: 'synth_designer', displayName: 'Synth Designer' },
  { name: 'midi_keyboard', displayName: 'MIDI Keyboard' },
  { name: 'sequencer', displayName: 'Sequencer' },
  { name: 'sample_library', displayName: 'Sample Library' },
  { name: 'control_panel', displayName: 'Control Panel' },
  { name: 'granulator', displayName: 'Granular Synthesizer' },
  { name: 'filter_designer', displayName: 'Filter Designer' },
  { name: 'sinsy', displayName: 'Sinsy' },
  { name: 'looper', displayName: 'Looper' },
];

const AddModulePicker: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [selectedModule, setSelectedModule] = useState(ViewContextDescriptors[0].displayName);

  const settings = useMemo(
    () => [
      {
        type: 'select',
        label: 'module',
        options: R.sortBy(
          R.toLower,
          ViewContextDescriptors.map(vc => vc.displayName)
        ),
      },
      {
        type: 'button',
        label: 'add',
        action: () => {
          const engine = getEngine();
          if (!engine) {
            console.error('Tried to add VC before engine initialized');
            return;
          }

          const vc = ViewContextDescriptors.find(vc => vc.displayName === selectedModule);
          if (!vc) {
            console.error('Tried to add unknown VC: ', selectedModule);
            return;
          }

          engine.create_view_context(vc.name);
          onClose();
        },
      },
    ],
    [onClose, selectedModule]
  );

  return (
    <>
      <div
        className='global-menu-backdrop'
        onClick={evt => {
          evt.stopPropagation();
          onClose();
        }}
      />
      <div className='add-module-picker-container'>
        <ControlPanel
          width={300}
          settings={settings}
          state={useMemo(() => ({ module: selectedModule }), [selectedModule])}
          onChange={useCallback((_key: string, value: any) => {
            setSelectedModule(value);
          }, [])}
        />
        <div className='module-description'>
          {ViewContextDescriptors.find(vc => vc.displayName === selectedModule)?.description ??
            null}
        </div>
      </div>
    </>
  );
};

export default AddModulePicker;
