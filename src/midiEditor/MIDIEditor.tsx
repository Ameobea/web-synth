import download from 'downloadjs';
import * as R from 'ramda';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import ControlPanel from 'react-control-panel';

import './MIDIEditor.scss';
import { SvelteComponentTyped } from 'svelte';

import { getExistingMIDICompositionTags, saveMIDIComposition } from 'src/api';
import FileUploader, { type Value as FileUploaderValue } from 'src/controls/FileUploader';
import { renderGenericPresetSaverWithModal } from 'src/controls/GenericPresetPicker/GenericPresetSaver';
import { getMidiImportSettings, type MidiFileInfo } from 'src/controls/MidiImportDialog';
import { renderModalWithControls, type ModalCompProps } from 'src/controls/Modal';
import { useIsGlobalBeatCounterStarted } from 'src/eventScheduler';
import type { MIDIEditorInstance } from 'src/midiEditor';
import { CVOutput } from 'src/midiEditor/CVOutput/CVOutput';
import { CVOutputTopControls } from 'src/midiEditor/CVOutput/CVOutputTopControls';
import { mkLoadMIDICompositionModal } from 'src/midiEditor/LoadMIDICompositionModal';
import { MIDIEditorControlButton } from 'src/midiEditor/MIDIEditorControlButton';
import MIDIEditorUIInstance, {
  type SerializedMIDIEditorState,
} from 'src/midiEditor/MIDIEditorUIInstance';
import BasicModal from 'src/misc/BasicModal';
import { mkImageLoadPlaceholder, useWindowSize } from 'src/reactUtils';
import { mkSvelteComponentShim } from 'src/svelteUtils';
import { AsyncOnce } from 'src/util';
import CVOutputControls from './CVOutput/CVOutputControls.svelte';
import './CVOutput/CVOutputControls.css';
import { get } from 'svelte/store';

const ctx = new AudioContext();

const MIDIWasmModule = new AsyncOnce(() => import('src/midi'));

interface MIDIEditorControlsState {
  bpm: number;
  loopEnabled: boolean;
  beatsPerMeasure: number;
  beatSnapInterval: number;
  metronomeEnabled: boolean;
}

const NOTE_ICON_STYLE = { height: 24, marginTop: -3 };
const SNAP_INTERVALS: { label: React.ReactNode | React.FC; beats: number; title: string }[] = [
  { label: '⍉', beats: 0, title: 'no snapping' },
  {
    label: mkImageLoadPlaceholder('𝅘𝅥', {
      src: `${process.env.ASSET_PATH}icons/music_notes/quarter_note.svg`,
      style: { ...NOTE_ICON_STYLE, height: 16, marginTop: 2 },
    }),
    beats: 1,
    title: '1 beat',
  },
  {
    label: mkImageLoadPlaceholder('𝅘𝅥𝅮', {
      src: `${process.env.ASSET_PATH}icons/music_notes/eigth_note.svg`,
      style: NOTE_ICON_STYLE,
    }),
    beats: 0.5,
    title: 'half a beat',
  },
  {
    label: '⅓',
    beats: 1 / 3,
    title: '1/3 beat',
  },
  {
    label: mkImageLoadPlaceholder('𝅘𝅥𝅯', {
      src: `${process.env.ASSET_PATH}icons/music_notes/sixteenth_note.svg`,
      style: NOTE_ICON_STYLE,
    }),
    beats: 1 / 4,
    title: 'one quarter beat',
  },
  {
    label: '⅙',
    beats: 1 / 6,
    title: '1/6 beat',
  },
  {
    label: mkImageLoadPlaceholder('𝅘𝅥𝅰', {
      src: `${process.env.ASSET_PATH}icons/music_notes/thirtysecond_note.svg`,
      style: NOTE_ICON_STYLE,
    }),
    beats: 1 / 8,
    title: 'one eighth beat',
  },
  {
    label: mkImageLoadPlaceholder('𝅘𝅥𝅱', {
      src: `${process.env.ASSET_PATH}icons/music_notes/sixtyfourth_note.svg`,
      style: NOTE_ICON_STYLE,
    }),
    beats: 1 / 16,
    title: 'one sixteenth beat',
  },
];

interface SnapControlsProps {
  onChange: (newBeatSnapInterval: number) => void;
  initialBeatSnapInterval: number;
}

const SnapControls: React.FC<SnapControlsProps> = ({ onChange, initialBeatSnapInterval }) => {
  const [beatSnapInterval, setBeatSnapInterval] = useState(initialBeatSnapInterval);

  return (
    <div className='midi-editor-beat-snap-controls'>
      {SNAP_INTERVALS.map(({ label: Label, beats, title }) => (
        <div
          key={beats}
          className='midi-editor-beat-snap-control-button'
          onClick={() => {
            onChange(beats);
            setBeatSnapInterval(beats);
          }}
          role='button'
          title={title}
          data-active={beatSnapInterval === beats ? 'true' : undefined}
        >
          {typeof Label === 'function' ? <Label /> : Label}
        </div>
      ))}
    </div>
  );
};

type UploadMIDIFileModalProps = ModalCompProps<{
  uploadedFile: FileUploaderValue;
}>;

const UploadMIDIFileModal: React.FC<UploadMIDIFileModalProps> = ({ onSubmit, onCancel }) => {
  const [uploadedFile, setUploadedFile] = useState<FileUploaderValue | null>(null);

  return (
    <BasicModal className='midi-modal'>
      <h2>Import MIDI File</h2>
      <p>Standard MIDI Files (.smf or .mid) can be uploaded here and loaded into the MIDI Editor</p>
      <ControlPanel
        style={{ width: '100%' }}
        settings={[
          { type: 'custom', Comp: FileUploader, label: 'select file', renderContainer: false },
          {
            type: 'button',
            label: 'upload',
            action: () => {
              if (!uploadedFile) {
                return;
              }
              onSubmit({ uploadedFile });
            },
          },
          { type: 'button', label: 'cancel', action: onCancel },
        ]}
        onChange={(_key: string, val: FileUploaderValue) => setUploadedFile(val)}
      />
    </BasicModal>
  );
};

const handleMIDIFileUpload = async (
  inst: React.MutableRefObject<MIDIEditorUIInstance | undefined>
) => {
  if (!inst.current) {
    return;
  }

  try {
    const [{ uploadedFile }, midiModule] = await Promise.all([
      renderModalWithControls(UploadMIDIFileModal),
      MIDIWasmModule.get(),
    ] as const);
    const bytes = new Uint8Array(uploadedFile.fileContent);

    const notesByMIDINumber: Map<number, { startPoint: number; length: number }[]> = new Map();
    for (let i = 0; i < 127; i++) {
      notesByMIDINumber.set(i, []);
    }

    await midiModule.load_midi_to_raw_note_bytes(
      bytes,
      (rawInfo: string): Promise<number> => {
        const fileInfo: MidiFileInfo = JSON.parse(rawInfo);
        // TODO: eventually we'll probably want to pass back a more complicated type than this
        return getMidiImportSettings(fileInfo).then(settings => settings.track);
      },
      (midiNumber: number, startBeat: number, length: number) => {
        const entries = notesByMIDINumber.get(midiNumber);
        if (!entries) {
          console.error('Invalid MIDI number from Wasm: ', midiNumber);
          return;
        }

        entries.push({ startPoint: startBeat, length });
      }
    );

    const curState = inst.current.serialize();
    const lines = [...notesByMIDINumber.entries()].map(([midiNumber, notes]) => ({
      midiNumber,
      notes,
    }));
    inst.current.reInitialize({
      ...curState,
      lines,
      view: { ...curState.view, scrollHorizontalBeats: 0 },
    });
  } catch (err) {
    if (err) {
      console.error('Error importing MIDI: ', err);
      // TODO: Display to user?
    }
  }
};

interface MIDIEditorControlsProps {
  parentInst: MIDIEditorInstance;
  inst: React.MutableRefObject<MIDIEditorUIInstance | undefined>;
  initialState: MIDIEditorControlsState;
  onChange: (newState: MIDIEditorControlsState) => void;
}

const MIDIEditorControlsInner: React.FC<MIDIEditorControlsProps> = ({
  parentInst,
  inst,
  initialState,
  onChange: onChangeInner,
}) => {
  const isGlobalBeatCounterStarted = useIsGlobalBeatCounterStarted();
  const [state, setStateInner] = useState(initialState);
  const [isRecording, setIsRecording] = useState(false);
  const [metronomeEnabled, setMetronomeEnabled] = useState(initialState.metronomeEnabled);
  const onChange = (newState: MIDIEditorControlsState) => {
    if (!inst.current) {
      return;
    }

    onChangeInner(newState);
    setStateInner(newState);
  };

  return (
    <div className='midi-editor-controls'>
      <MIDIEditorControlButton
        disabled={isGlobalBeatCounterStarted}
        title='Start/Stop Playback'
        onClick={() => {
          if (!inst.current) {
            return;
          }
          const playbackHandler = inst.current.parentInstance.playbackHandler;

          if (playbackHandler.isPlaying) {
            playbackHandler.stopPlayback();
          } else {
            playbackHandler.startPlayback({
              type: 'localTempo',
              bpm: state.bpm,
              startTime: ctx.currentTime,
            });
          }
        }}
        label='⏯'
        style={{ lineHeight: '46px' }}
      />
      <MIDIEditorControlButton
        onClick={() => {
          if (!inst.current) {
            return;
          }

          const playbackHandler = inst.current.parentInstance.playbackHandler;
          if (isRecording) {
            setIsRecording(false);
            playbackHandler.stopRecording();
            return;
          }

          setIsRecording(true);
          playbackHandler.startRecording();
        }}
        title={isRecording ? 'Stop recording MIDI' : 'Start recording MIDI'}
        label={<div style={{ marginLeft: -1 }}>⏺</div>}
        style={{
          fontSize: 46,
          textAlign: 'center',
          color: 'red',
          backgroundColor: isRecording ? '#881111' : undefined,
          lineHeight: '48px',
        }}
      />
      <MIDIEditorControlButton
        onClick={() => {
          if (!inst.current || inst.current.parentInstance.playbackHandler.isPlaying) {
            return;
          }

          inst.current.parentInstance.playbackHandler.metronomeEnabled = !metronomeEnabled;
          setMetronomeEnabled(!metronomeEnabled);
        }}
        label={
          <img
            src={`${process.env.ASSET_PATH}metronome.svg`}
            style={{
              filter: 'invert(1)',
              marginTop: 3,
              width: 36,
            }}
          />
        }
        title={state.loopEnabled ? 'Disable Metronome' : 'Enable Metronome'}
        style={{
          fontSize: 15,
          textAlign: 'center',
          backgroundColor: metronomeEnabled ? '#440044' : undefined,
        }}
        active={metronomeEnabled}
      />
      <MIDIEditorControlButton
        onClick={() => {
          if (inst.current?.parentInstance.playbackHandler?.isPlaying !== false) {
            return;
          }

          onChange({ ...state, loopEnabled: !state.loopEnabled });
        }}
        label='LOOP'
        title={state.loopEnabled ? 'Disable Loop' : 'Enable Loop'}
        style={{ fontSize: 15, textAlign: 'center' }}
        active={state.loopEnabled}
      />
      <MIDIEditorControlButton
        onClick={() => {
          if (inst.current?.parentInstance.playbackHandler?.isPlaying !== false) {
            return;
          }

          if (!inst.current || inst.current.parentInstance.playbackHandler?.isPlaying !== false) {
            return;
          }

          inst.current.copySelection();
        }}
        label={
          // Adapted from: https://stackoverflow.com/a/60023353/3833068
          <div style={{ marginTop: -2 }}>
            <span
              style={{
                fontSize: '.875em',
                marginRight: '.125em',
                position: 'relative',
                top: '-.25em',
                left: '-.125em',
              }}
            >
              📄<span style={{ position: 'absolute', top: '.15em', left: '.25em' }}>📄</span>
            </span>
          </div>
        }
        title='Copy selection'
        style={{ fontSize: 24, textAlign: 'center' }}
      />
      <MIDIEditorControlButton
        onClick={() => {
          if (!inst.current || inst.current.parentInstance.playbackHandler?.isPlaying !== false) {
            return;
          }

          inst.current.cutSelection();
        }}
        label='✂️'
        title='Cut selection'
        style={{ fontSize: 24, textAlign: 'center' }}
      />
      <MIDIEditorControlButton
        onClick={() => {
          if (!inst.current || inst.current.parentInstance.playbackHandler?.isPlaying !== false) {
            return;
          }

          inst.current.pasteSelection();
        }}
        label='📋'
        title='Paste selection'
        style={{ fontSize: 24, textAlign: 'center' }}
      />
      <MIDIEditorControlButton
        onClick={async () => {
          if (!inst.current) {
            return;
          }

          const proceed = confirm('Really clear all notes?');
          if (!proceed) {
            return;
          }

          for (const noteId of inst.current.allNotesByID.keys()) {
            inst.current.deleteNote(noteId);
          }
        }}
        title='Clear all notes'
        label='✕'
        style={{ fontSize: 29, textAlign: 'center', color: 'red' }}
      />
      <MIDIEditorControlButton
        onClick={async () => {
          if (!inst.current) {
            return;
          }

          inst.current.snapAllSelectedNotes();
        }}
        title='Auto-snap all selected notes'
        label='▥'
        style={{ fontSize: 40, textAlign: 'center', lineHeight: '36px' }}
      />
      <div className='labeled-container'>
        <label>BPM</label>
        <input
          type='number'
          value={state.bpm}
          onChange={evt => onChange({ ...state, bpm: +evt.target.value })}
          style={{ marginLeft: -1, fontSize: 20 }}
        />
      </div>
      <div className='labeled-container'>
        <label>Snap Interval</label>
        <SnapControls
          onChange={newBeatSnapInterval => inst.current?.setBeatSnapInterval(newBeatSnapInterval)}
          initialBeatSnapInterval={initialState.beatSnapInterval}
        />
      </div>
      <div className='labeled-container' style={{ marginLeft: -7 }}>
        <label style={{ lineHeight: '9px' }}>
          Notes per
          <br />
          Measure
        </label>
        <input
          type='number'
          value={state.beatsPerMeasure}
          onChange={evt => onChange({ ...state, beatsPerMeasure: +evt.target.value })}
          style={{ width: 63, fontSize: 20 }}
        />
      </div>
      <MIDIEditorControlButton
        onClick={async () => {
          if (!inst.current) {
            return;
          }

          try {
            const { name, description, tags } = await renderGenericPresetSaverWithModal({
              description: true,
              getExistingTags: getExistingMIDICompositionTags,
            });
            const composition = inst.current!.serialize();
            await saveMIDIComposition(name, description ?? '', composition, tags ?? []);
          } catch (err) {
            return;
          }
        }}
        label='💾'
        title='Save MIDI Composition'
        style={{ fontSize: 18, textAlign: 'center' }}
        active={state.loopEnabled}
      />
      <MIDIEditorControlButton
        onClick={async () => {
          if (!inst.current || inst.current.parentInstance.playbackHandler.isPlaying) {
            return;
          }

          try {
            const {
              preset: { composition },
            } = await mkLoadMIDICompositionModal();

            inst.current.reInitialize(composition);
          } catch (_err) {
            return;
          }
        }}
        title='Load MIDI Composition'
        label='📂'
        style={{ fontSize: 18, textAlign: 'center' }}
        active={state.loopEnabled}
      />
      <MIDIEditorControlButton
        onClick={() => handleMIDIFileUpload(inst)}
        title='Upload MIDI File'
        label='⭱'
        style={{ fontSize: 29, textAlign: 'center' }}
      />
      <MIDIEditorControlButton
        onClick={async () => {
          if (!inst.current) {
            return;
          }

          const rawNoteDataBuf = inst.current.exportToRawNoteDataBuffer();
          const midiModule = await MIDIWasmModule.get();
          const midiFileData = midiModule.write_to_midi('midi_composition', rawNoteDataBuf);
          download(midiFileData, 'midi_composition.mid', 'audio/midi');
        }}
        title='Download MIDI File'
        label='⭳'
        style={{ fontSize: 29, textAlign: 'center' }}
      />

      <CVOutputTopControls inst={parentInst} />
    </div>
  );
};

const MIDIEditorControls = React.memo(MIDIEditorControlsInner);

type CVOutputControlsProps = CVOutputControls extends SvelteComponentTyped<infer Props, any>
  ? Props
  : never;

const CVOutputControlsShim = mkSvelteComponentShim<CVOutputControlsProps>(CVOutputControls);

interface MIDIEditorProps {
  initialState: SerializedMIDIEditorState;
  width: number;
  height: number;
  instance: MIDIEditorInstance;
  vcId: string;
}

const MIDIEditor: React.FC<MIDIEditorProps> = ({
  initialState,
  instance: parentInstance,
  vcId,
}) => {
  const instance = useRef<MIDIEditorUIInstance | undefined>();
  useEffect(() => () => instance.current?.destroy(), []);
  const initialStateForControls = useRef({
    bpm: initialState.localBPM ?? 120,
    loopEnabled: !R.isNil(initialState.loopPoint),
    beatsPerMeasure: initialState.view.beatsPerMeasure,
    beatSnapInterval: initialState.beatSnapInterval,
    metronomeEnabled: initialState.metronomeEnabled,
  });

  const windowSize = useWindowSize();
  const height = windowSize.height - 140;
  const width = windowSize.width - 80;
  const lastWindowWidth = useRef(windowSize);
  useEffect(() => {
    if (lastWindowWidth.current.width !== windowSize.width) {
      lastWindowWidth.current = windowSize;
      instance.current?.setSize(width, height);
    }
  }, [height, width, windowSize]);

  const handleChange = useCallback(
    ({ bpm, loopEnabled }: MIDIEditorControlsState) => {
      parentInstance.uiInstance!.localBPM = bpm;
      if (loopEnabled === R.isNil(parentInstance.uiInstance!.loopCursor)) {
        parentInstance.uiInstance!.toggleLoop();
      }
    },
    [parentInstance.uiInstance]
  );

  const lastCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [cvOutputs, setCVOutputs] = useState<CVOutput[]>([]);
  useEffect(
    () => parentInstance.cvOutputs.subscribe(newOutputs => setCVOutputs([...newOutputs])),
    [parentInstance.cvOutputs]
  );

  return (
    <div className='midi-editor'>
      <MIDIEditorControls
        parentInst={parentInstance}
        inst={instance}
        initialState={initialStateForControls.current}
        onChange={handleChange}
      />
      <canvas
        ref={canvas => {
          if (!canvas) {
            instance.current?.destroy();
            instance.current = undefined;
            lastCanvasRef.current = null;
            return;
          }

          if (canvas === lastCanvasRef.current) {
            return;
          }
          lastCanvasRef.current = canvas;

          instance.current = new MIDIEditorUIInstance(
            width,
            height,
            canvas,
            initialState,
            parentInstance,
            vcId,
            parentInstance.cvOutputs
          );
          parentInstance.registerUI(instance.current);
        }}
        onMouseDown={useCallback((evt: React.MouseEvent<HTMLCanvasElement>) => {
          // Prevent clicks on the canvas from selecting text and stuff in the rest of the page
          evt.preventDefault();
          evt.stopPropagation();
        }, [])}
        onContextMenu={useCallback((evt: React.MouseEvent<HTMLCanvasElement>) => {
          evt.preventDefault();
          evt.stopPropagation();
        }, [])}
      />
      {cvOutputs.length > 0 ? (
        <div className='cv-outputs-wrapper'>
          {cvOutputs.map(output => (
            <CVOutputControlsShim
              key={output.name}
              name={output.name}
              state={output.state}
              deleteOutput={() => parentInstance.deleteCVOutput(output.name)}
              setName={newName => parentInstance.renameCVOutput(output.name, newName)}
              registerInstance={uiInstance => output.registerUIInstance(uiInstance)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
};

// const MIDIEditorMemo = React.memo(MIDIEditor);
const MIDIEditorMemo = MIDIEditor;

export default MIDIEditorMemo;
