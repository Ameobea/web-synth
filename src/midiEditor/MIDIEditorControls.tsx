import React, { useMemo } from 'react';
import ControlPanel from 'react-control-panel';
import downloadjs from 'downloadjs';

import FileUploader, { Value as FileUploaderValue } from '../controls/FileUploader';
import { MidiFileInfo, getMidiImportSettings } from '../controls/MidiImportDialog';

const MIDIEditorControls: React.FC<{ engine: typeof import('../engine') }> = ({ engine }) => {
  const onChange = useMemo<(key: string, val: any) => void>(
    () => async (key, val) => {
      switch (key) {
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
          engine.handle_message('set_raw_note_data', rawNoteData);
          break;
        }
        default: {
          console.error(`Unhandled state key in MIDI editor controls: ${key}`);
        }
      }
    },
    [engine]
  );

  return (
    <ControlPanel
      onChange={onChange}
      width={400}
      position='top-right'
      draggable
      settings={[
        {
          type: 'button',
          label: 'export midi',
          action: async () => {
            const midiModule = await import('../midi');
            const noteData = engine.handle_message('export_midi', new Uint8Array());
            if (!noteData) {
              console.error('MIDI Wasm module returned undefined when handling exported MIDI');
              return;
            }
            const midiFileBytes = midiModule.write_to_midi('midi_export', noteData);
            downloadjs(new Blob([midiFileBytes]), 'composition.midi', 'application/x-midi');
          },
        },
        { type: 'custom', label: 'upload midi', renderContainer: false, Comp: FileUploader },
      ]}
    />
  );
};

export default MIDIEditorControls;
