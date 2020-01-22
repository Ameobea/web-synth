import React, { useMemo, useState } from 'react';
import ControlPanel from 'react-control-panel';
import downloadjs from 'downloadjs';

import FileUploader, { Value as FileUploaderValue } from '../controls/FileUploader';
import { MidiFileInfo, getMidiImportSettings } from '../controls/MidiImportDialog';
import { MIDIEditorStateMap } from 'src/midiEditor';

const ctx = new AudioContext();

const MIDIEditorControls: React.FC<{
  engine: typeof import('../engine');
  vcId: string;
}> = ({ engine, vcId }) => {
  const [isRecordingMIDI, setIsRecordingMIDI] = useState(false);

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
        case 'bpm': {
          const buf = new Float64Array(2);
          buf[0] = val;
          buf[1] = ctx.currentTime;
          engine.handle_message('set_bpm', new Uint8Array(buf.buffer));
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
        { type: 'range', label: 'bpm', min: 20, max: 400 },
        {
          type: 'button',
          label: 'toggle loop',
          action: () => {
            const vals = new Float64Array(1);
            vals[0] = ctx.currentTime;
            engine.handle_message('toggle_loop', new Uint8Array(vals.buffer));
          },
        },
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
        {
          type: 'button',
          label: isRecordingMIDI ? 'start recording' : 'stop recording',
          action: () => {
            setIsRecordingMIDI(!isRecordingMIDI);

            const state = MIDIEditorStateMap.get(vcId);
            if (!state) {
              console.error(`No midi editor state map entry for vcId "${vcId}"`);
              return;
            }

            if (state.isRecordingMIDI !== isRecordingMIDI) {
              console.error(
                'State mismatch between MIDI editor state and UI hook state regarding MIDI recording status'
              );
            } else {
              state.isRecordingMIDI = !state.isRecordingMIDI;
            }

            if (isRecordingMIDI) {
              engine.midi_editor_stop_recording_midi(ctx.currentTime);
            } else {
              engine.midi_editor_start_recording_midi(ctx.currentTime);
            }
          },
        },
      ]}
    />
  );
};

export default MIDIEditorControls;
