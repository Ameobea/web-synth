import * as R from 'ramda';
import React, { useCallback, useMemo, useState } from 'react';
import ControlPanel from 'react-control-panel';

import './GlobalVolume.css';
import { getEngine } from 'src/util';
import { createPortal } from 'react-dom';

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
  {
    name: 'welcome_page',
    displayName: 'Welcome Page',
    description:
      'The page showing info about web synth and links to demos that is shown when the application is first loaded',
  },
  {
    name: 'signal_analyzer',
    displayName: 'Signal Analyzer',
    description:
      'Contains visualizations for analyzing sound including an oscilloscope and spectrogram',
  },
  { name: 'sampler', displayName: 'Sampler' },
];

interface AddModulePickerProps {
  onClose: () => void;
}

const AddModulePicker: React.FC<AddModulePickerProps> = ({ onClose }) => {
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

          engine.create_view_context(vc.name, selectedModule);
          onClose();
        },
      },
    ],
    [onClose, selectedModule]
  );

  return (
    <>
      {createPortal(
        <div
          className='global-menu-backdrop'
          onClick={evt => {
            evt.stopPropagation();
            onClose();
          }}
        />,
        document.getElementById('content')!
      )}
      {createPortal(
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
        </div>,
        document.getElementById('content')!
      )}
    </>
  );
};

export default AddModulePicker;
