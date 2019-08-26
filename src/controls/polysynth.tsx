import React, { useMemo } from 'react';
import ControlPanel from 'react-control-panel';
import BitCrusher from 'tone/Tone/effect/BitCrusher';
import downloadjs from 'downloadjs';

import { PolySynth } from '../synth';
import FileUploader, { Value as FileUploaderValue } from '../controls/FileUploader';
import { MidiFileInfo, getMidiImportSettings } from '../controls/MidiImportDialog';
import { ControlPanelADSR, defaultAdsrEnvelope } from './adsr';

export const mkBitcrusher = () => new BitCrusher(5).toMaster();

interface PolySynthProps {
  synth: PolySynth;
  engine: typeof import('../engine');
}

const PolySynthControls = ({ synth, engine }: PolySynthProps) => {
  const onChange = useMemo<(key: string, val: any) => void>(
    () => async (key, val) => {
      switch (key) {
        case 'bitcrusher': {
          synth.volume.disconnect();
          if (val) {
            // synth.volume.connect(mkBitcrusher());
          } else {
            // TODO: we have to store children somewhere so we can disconnect from them
            // explicitly and `.dispose()` of them properly.  Probably keep an array of children in
            // `PolySynth` and do that handling there.
            // synth.volume.toMaster();
            // synth.volume.output.dispose();
          }
          break;
        }
        case 'volume': {
          synth.volume.set('volume', +val);
          break;
        }
        case 'adsr': {
          synth.setEnvelope(val);
          break;
        }
        case 'upload midi': {
          const uploadedFile: FileUploaderValue = val;
          console.log('loaded file: ', uploadedFile);
          const bytes = new Uint8Array(uploadedFile.fileContent);
          const midiModule = await import('../midi');
          const rawNoteData: Uint8Array = await midiModule.load_midi_to_raw_note_bytes(
            bytes,
            (rawInfo: string): Promise<number> => {
              const fileInfo: MidiFileInfo = JSON.parse(rawInfo);
              // TODO: eventually we'll want to pass back a more complicated type than this
              return getMidiImportSettings(fileInfo).then(settings => settings.track);
            }
          );
          console.log('Loaded raw note data: ', rawNoteData);
          engine.handle_message('set_raw_note_data', rawNoteData);
          break;
        }
        default: {
          const parsed = parseFloat(val);
          synth.voices.forEach(voice => voice.set(key, isNaN(parsed) ? val : parsed));
        }
      }
    },
    [synth]
  );

  return (
    <ControlPanel
      onChange={onChange}
      width={400}
      position='top-right'
      draggable
      settings={[
        { type: 'range', label: 'volume', min: -30, max: 20, initial: -16, steps: 200 },
        {
          type: 'select',
          label: 'oscillator.type',
          options: ['sine', 'square', 'triangle', 'sawtooth'],
          initial: 'sine',
        },
        { type: 'checkbox', label: 'bitcrusher', initial: false },
        { type: 'custom', label: 'adsr', initial: defaultAdsrEnvelope, Comp: ControlPanelADSR },
        {
          type: 'button',
          label: 'export midi',
          action: async () => {
            const midiModule = await import('../midi');
            const noteData = engine.handle_message('export_midi', new Uint8Array());
            const midiFileBytes = midiModule.write_to_midi('midi_export', noteData);
            downloadjs(new Blob([midiFileBytes]), 'composition.midi', 'application/x-midi');
          },
        },
        { type: 'custom', label: 'upload midi', renderContainer: false, Comp: FileUploader },
      ]}
    />
  );
};

export default PolySynthControls;
