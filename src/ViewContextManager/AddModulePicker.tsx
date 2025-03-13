import * as R from 'ramda';
import React, { useCallback, useMemo, useState } from 'react';
import ControlPanel from 'react-control-panel';

import './GlobalVolume.css';
import { getEngine } from 'src/util';
import { createPortal } from 'react-dom';
import { VirtualVCDefinitions } from 'src/ViewContextManager/virtualVCDefinitions';

export interface ViewContextDescriptor {
  name: string;
  /**
   * If set, this will be the VC type used under the hood.  Used for virtual VCs so they can have unique
   * names but share the underlying implementation.
   */
  nameAlias?: string;
  displayName: string;
  description?: string;
  /**
   * This will be set into localStorage for the VC's state key if provided to override the default
   * initial state.
   *
   * It can be used to implement virtual VCs like reverb that use the code editor under the hood.
   */
  initialState?: string;
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
  {
    name: 'graph_editor',
    displayName: 'Graph Editor',
    description:
      'View and edit the audio graph powering web synth.  Add new nodes/modules and connect them together to create patches.',
  },
  {
    name: 'composition_sharing',
    displayName: 'Composition Sharing',
    description: 'Save and load compositions, as well as view compositions from other users',
  },
  {
    name: 'synth_designer',
    displayName: 'Synth Designer',
    description:
      'Versatile polyphonic synthesizer supporting FM, Wavetable, and sample-based synthesis.  Includes extensive support for modulation and many built-in effects and filters.',
  },
  {
    name: 'midi_keyboard',
    displayName: 'MIDI Keyboard',
    description:
      'Use your computer keyboard or a hardware MIDI device to drive synthesizers or other modules in web synth',
  },
  {
    name: 'sequencer',
    displayName: 'Sequencer',
    description:
      'Define looping sequence of samples to play back.  NOTE: using "sample mapping" mode in the synth designer and sequencing via the MIDI editor often works better and supports much more versatile options.',
  },
  {
    name: 'sample_library',
    displayName: 'Sample Library',
    description: 'Load, browser, and manage external audio samples',
  },
  {
    name: 'control_panel',
    displayName: 'Control Panel',
    description:
      'Build a customizable UI for your composition.  Supports controls like buttons and sliders as well as MIDI input and inline visualizations.',
  },
  {
    name: 'granulator',
    displayName: 'Granular Synthesizer',
    description:
      'Load a sample and generate sound from it using granular synthesis.  Supports variable-rate playback for time stretching and pitch shifting as well as modulation of parameters.',
  },
  {
    name: 'filter_designer',
    displayName: 'Filter Designer',
    description:
      'Build-your-own equalizer by composing many biquad filters in series or parallel.  Supports filter parameter modulation.',
  },
  {
    name: 'sinsy',
    displayName: 'Sinsy',
    description: 'DEPRECATED and likely not working experiment with vocal synthesis using Sinsy',
  },
  {
    name: 'looper',
    displayName: 'Looper',
    description: 'Supports playback and sequencing of MIDI compositions',
  },
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
  {
    name: 'sampler',
    displayName: 'Sampler',
    description:
      'Chop up, manipulate, and play back pieces of samples in response to incoming MIDI events.  Useful for creating vocal chops and stuff like that.',
  },
  {
    name: 'equalizer',
    displayName: 'Equalizer',
    description:
      'Visual parametric EQ supporting multiple bands and modulation of filter parameters',
  },
  // -- virtual VCs --
  ...VirtualVCDefinitions,
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
