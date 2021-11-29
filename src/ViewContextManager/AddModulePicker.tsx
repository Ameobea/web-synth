import React, { useCallback, useMemo, useState } from 'react';
import ControlPanel from 'react-control-panel';
import { getEngine } from 'src/util';

import './GlobalVolume.scss';

const viewContexts: {
  children: string;
  name: string;
  displayName: string;
  description?: string;
}[] = [
  { children: 'M', name: 'midi_editor', displayName: 'MIDI Editor', description: 'test' },
  { children: 'E', name: 'faust_editor', displayName: 'Faust Code Editor' },
  { children: 'G', name: 'graph_editor', displayName: 'Graph Editor' },
  { children: 'S', name: 'composition_sharing', displayName: 'Composition Sharing' },
  { children: 'D', name: 'synth_designer', displayName: 'Synth Designer' },
  { children: 'K', name: 'midi_keyboard', displayName: 'MIDI Keyboard' },
  { children: '𝍖', name: 'sequencer', displayName: 'Sequencer' },
  { children: 'L', name: 'sample_library', displayName: 'Sample Library' },
  { children: 'P', name: 'control_panel', displayName: 'Control Panel' },
  { children: '⋱', name: 'granulator', displayName: 'Granular Synthesizer' },
  { children: 'F', name: 'filter_designer', displayName: 'Filter Designer' },
  { children: 'V', name: 'sinsy', displayName: 'Sinsy' },
];

const AddModulePicker: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [selectedModule, setSelectedModule] = useState(viewContexts[0].displayName);

  const settings = useMemo(
    () => [
      { type: 'select', label: 'module', options: viewContexts.map(vc => vc.displayName) },
      {
        type: 'button',
        label: 'add',
        action: () => {
          const engine = getEngine();
          if (!engine) {
            console.error('Tried to add VC before engine initialized');
            return;
          }

          const vc = viewContexts.find(vc => vc.displayName === selectedModule);
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
          {viewContexts.find(vc => vc.displayName === selectedModule)?.description ?? null}
        </div>
      </div>
    </>
  );
};

export default AddModulePicker;
