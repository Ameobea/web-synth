import { filterNils } from 'ameo-utils';
import React, { useEffect, useRef, useState } from 'react';
import * as R from 'ramda';
import { useQuery } from 'react-query';
import ControlPanel from 'react-control-panel';

import { useIsGlobalBeatCounterStarted } from 'src/eventScheduler';
import { MIDIEditorInstance } from 'src/midiEditor';
import MIDIEditorUIInstance, {
  SerializedMIDIEditorState,
} from 'src/midiEditor/MIDIEditorUIInstance';
import './MIDIEditor.scss';
import { ModalCompProps, renderModalWithControls } from 'src/controls/Modal';
import { mkSavePresetModal } from 'src/synthDesigner/SavePresetModal';
import { getSavedMIDICompositions, SavedMIDIComposition, saveMIDIComposition } from 'src/api';
import BasicModal from 'src/misc/BasicModal';
import { withReactQueryClient } from 'src/reactUtils';
import FileUploader, { Value as FileUploaderValue } from 'src/controls/FileUploader';
import { AsyncOnce } from 'src/util';
import { MidiFileInfo, getMidiImportSettings } from 'src/controls/MidiImportDialog';

const ctx = new AudioContext();

const MIDIWasmModule = new AsyncOnce(() => import('src/midi'));

const MIDIEditorControlButton: React.FC<{
  onClick: () => void;
  label: React.ReactNode;
  disabled?: boolean;
  style?: React.CSSProperties;
  active?: boolean;
  title: string;
}> = ({ onClick, label, disabled, style, active, title }) => (
  <div
    role='button'
    className={filterNils(['midi-editor-control-button', active ? 'active' : null]).join(' ')}
    style={disabled ? { ...(style ?? {}), color: '#666' } : style}
    onClick={disabled ? undefined : onClick}
    title={title}
  >
    {label}
  </div>
);

interface MIDIEditorControlsState {
  bpm: number;
  loopEnabled: boolean;
  beatsPerMeasure: number;
  beatSnapInterval: number;
}

const SNAP_INTERVALS: { label: React.ReactNode; beats: number; title: string }[] = [
  { label: '⍉', beats: 0, title: 'no snapping' },
  { label: <>&#119135;</>, beats: 1, title: '1 beat' },
  { label: <>&#119136;</>, beats: 0.5, title: 'half a beat' },
  { label: <>&#119137;</>, beats: 1 / 4, title: 'one quarter beat' },
  { label: <>&#119138;</>, beats: 1 / 8, title: 'one eighth beat' },
  { label: <>&#119139;</>, beats: 1 / 16, title: 'one sixteenth beat' },
];

const SnapControls: React.FC<{
  onChange: (newBeatSnapInterval: number) => void;
  initialBeatSnapInterval: number;
}> = ({ onChange, initialBeatSnapInterval }) => {
  const [beatSnapInterval, setBeatSnapInterval] = useState(initialBeatSnapInterval);

  return (
    <div className='midi-editor-beat-snap-controls'>
      {SNAP_INTERVALS.map(({ label, beats, title }) => (
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
          {label}
        </div>
      ))}
    </div>
  );
};

const LoadMIDICompositionModalContent: React.FC<{
  midiCompositions: SavedMIDIComposition[] | undefined;
  onSubmit: (args: { composition: SavedMIDIComposition }) => void;
  onCancel: (() => void) | undefined;
}> = ({ midiCompositions, onSubmit, onCancel }) => {
  const controlPanelCtx = useRef<null | any>(null);
  if (!midiCompositions) {
    return (
      <>
        <i>Loading MIDI Compositions...</i>
        <br />
        {onCancel ? (
          <ControlPanel settings={[{ type: 'button', label: 'cancel', action: onCancel }]} />
        ) : null}
      </>
    );
  }

  return (
    <>
      <ControlPanel
        contextCb={(ctx: any) => {
          controlPanelCtx.current = ctx;
        }}
        settings={filterNils([
          {
            label: 'composition',
            type: 'select',
            options: R.zipObj(
              midiCompositions.map(R.prop('name')),
              midiCompositions.map(R.prop('id'))
            ),
            initial: midiCompositions[0].id,
          },
          onCancel ? { type: 'button', label: 'cancel', action: onCancel } : null,
          {
            type: 'button',
            label: 'load',
            action: () => {
              if (!controlPanelCtx.current) {
                console.warn('Submitted w/o control panel ctx being set');
                return;
              }
              const proceed = confirm('Really clear current composition and load new one?');
              if (!proceed) {
                return;
              }

              const compositionID = controlPanelCtx.current.composition;
              const composition = midiCompositions.find(R.propEq('id', compositionID));
              if (!composition) {
                console.error('Selected composition not loaded, id=' + compositionID);
                return;
              }
              onSubmit({ composition });
            },
          },
        ])}
      />
    </>
  );
};

const LoadMIDICompositionModal: React.FC<ModalCompProps<{ composition: SavedMIDIComposition }>> = ({
  onSubmit,
  onCancel,
}) => {
  const { data: midiCompositions } = useQuery(['midiCompositions'], getSavedMIDICompositions);

  return (
    <BasicModal className='midi-modal'>
      <h2>Load MIDI Composition</h2>
      <LoadMIDICompositionModalContent
        midiCompositions={midiCompositions}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    </BasicModal>
  );
};

const UploadMIDIFileModal: React.FC<
  ModalCompProps<{
    uploadedFile: FileUploaderValue;
  }>
> = ({ onSubmit, onCancel }) => {
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

const MIDIEditorControls: React.FC<{
  inst: React.MutableRefObject<MIDIEditorUIInstance | undefined>;
  initialState: MIDIEditorControlsState;
  onChange: (newState: MIDIEditorControlsState) => void;
}> = ({ inst, initialState, onChange: onChangeInner }) => {
  const isGlobalBeatCounterStarted = useIsGlobalBeatCounterStarted();
  const [state, setStateInner] = useState(initialState);
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
      <div className='labeled-container'>
        <label>BPM</label>
        <input
          type='number'
          value={state.bpm}
          onChange={evt => onChange({ ...state, bpm: +evt.target.value })}
          style={{ marginLeft: -1 }}
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
          style={{ width: 63 }}
        />
      </div>
      <MIDIEditorControlButton
        onClick={async () => {
          if (!inst.current) {
            return;
          }

          try {
            const { title, description } = await renderModalWithControls(
              mkSavePresetModal(<h2>Save MIDI Composition</h2>)
            );
            const composition = inst.current!.serialize();
            await saveMIDIComposition(title, description, composition);
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
          if (!inst.current) {
            return;
          }

          try {
            const {
              composition: { composition },
            } = await renderModalWithControls(withReactQueryClient(LoadMIDICompositionModal));
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
        onClick={async () => {
          if (!inst.current) {
            return;
          }

          try {
            const [{ uploadedFile }, midiModule] = await Promise.all([
              renderModalWithControls(UploadMIDIFileModal),
              MIDIWasmModule.get(),
            ] as const);
            const bytes = new Uint8Array(uploadedFile.fileContent);

            const notesByMIDINumber: Map<
              number,
              { startPoint: number; length: number }[]
            > = new Map();
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
        }}
        title='Upload MIDI File'
        label='⭱'
        style={{ fontSize: 29, textAlign: 'center' }}
      />
      <MIDIEditorControlButton
        onClick={() => {
          // TODO
        }}
        title='Download MIDI File'
        label='⭳'
        style={{ fontSize: 29, textAlign: 'center' }}
      />
    </div>
  );
};

const MIDIEditor: React.FC<{
  initialState: SerializedMIDIEditorState;
  width: number;
  height: number;
  instance: MIDIEditorInstance;
}> = ({ initialState, width, height, instance: parentInstance }) => {
  const instance = useRef<MIDIEditorUIInstance | undefined>();
  useEffect(() => {
    return () => {
      if (!instance.current) {
        return;
      }
      instance.current.destroy();
    };
  }, []);

  return (
    <div className='midi-editor'>
      <MIDIEditorControls
        inst={instance}
        initialState={{
          bpm: initialState.localBPM ?? 120,
          loopEnabled: !R.isNil(initialState.loopPoint),
          beatsPerMeasure: initialState.view.beatsPerMeasure,
          beatSnapInterval: initialState.beatSnapInterval,
        }}
        onChange={({ bpm, loopEnabled }) => {
          parentInstance.uiInstance!.localBPM = bpm;
          if (loopEnabled === R.isNil(parentInstance.uiInstance!.loopCursor)) {
            parentInstance.uiInstance!.toggleLoop();
          }
        }}
      />
      <canvas
        style={{ width, height }}
        ref={ref => {
          if (!ref) {
            instance.current?.destroy();
            instance.current = undefined;
            return;
          }

          instance.current = new MIDIEditorUIInstance(
            width,
            height,
            ref,
            initialState,
            parentInstance
          );
          parentInstance.registerUI(instance.current);
        }}
        onMouseDown={evt => {
          // Prevent clicks on the canvas from selecting text and stuff in the rest of the page
          evt.preventDefault();
          evt.stopPropagation();
        }}
        onContextMenu={evt => {
          evt.preventDefault();
          evt.stopPropagation();
        }}
      />
    </div>
  );
};

export default MIDIEditor;
