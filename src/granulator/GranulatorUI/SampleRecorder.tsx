import { filterNils } from 'ameo-utils';
import React, { useMemo, useRef, useState } from 'react';
import ControlPanel from 'react-control-panel';
import { Provider } from 'react-redux';

import { ModalCompProps, renderModalWithControls } from 'src/controls/Modal';
import SampleEditor from 'src/granulator/GranulatorUI/SampleEditor';
import { WaveformRenderer } from 'src/granulator/GranulatorUI/WaveformRenderer';
import BasicModal from 'src/misc/BasicModal';
import { ReduxStore, store, useSelector } from 'src/redux';
import { addLocalSample } from 'src/sampleLibrary';

const NoInput: React.FC = () => (
  <i>
    No input is currently connected to this node, so recording samples is not possible. If
    you&apos;d like to record the output of the granular synthesizer itself, patch it into itself
    with an intermediary node like a gain node.
  </i>
);

const ctx = new AudioContext();

type RecordingStatus =
  | { type: 'notStarted' }
  | { type: 'recording'; startTime: number }
  | {
      type: 'stopped';
      length: number;
      selectionStartMs: number | null;
      selectionEndMs: number | null;
    };

const ExportModal: React.FC<ModalCompProps<{ name: string }>> = ({ onSubmit, onCancel }) => {
  const [sampleName, setSampleName] = useState('');

  const canSubmit = !!sampleName;

  return (
    <BasicModal>
      <h2>Export to Sample Library</h2>
      <div className='input-container'>
        <label htmlFor='export-modal-sample-name'>Name</label>
        <input
          id='export-modal-sample-name'
          value={sampleName}
          onChange={evt => setSampleName(evt.target.value)}
        />
      </div>

      <div className='buttons-container'>
        <button onClick={onCancel}>cancel</button>
        <button onClick={() => onSubmit({ name: sampleName })} disabled={!canSubmit}>
          submit
        </button>
      </div>
    </BasicModal>
  );
};

const handleExport = async (encoded: ArrayBuffer) => {
  const { name } = await renderModalWithControls(ExportModal);
  await addLocalSample({ name: name + '.wav', isLocal: true }, encoded);
};

const mkHandleAWPMessage = (recordingState: RecordingState) =>
  function handleAWPMessage(this: MessagePort, evt: MessageEvent<any>) {
    const inst = recordingState.waveformRenderer;
    if (!inst) {
      return;
    }

    switch (evt.data.type) {
      case 'recordingBlock': {
        if (evt.data.index === recordingState.lastWrittenChunkIx + 1) {
          // We received an in-order chunk; write it into the samples buffer directly
          recordingState.lastWrittenChunkIx += 1;
          inst.appendSamples(evt.data.block);
          inst.setBounds(inst.getBounds().startMs, inst.getSampleLengthMs());
          return;
        }

        // TODO: Handle out-of-order chunks
        console.error(
          `Out-of-order chunk received with index=${evt.data.index}, last chunk index={recordingState.lastWrittenChunkIx}`
        );

        break;
      }
      case 'encodedRecording': {
        const encoded: ArrayBuffer = evt.data.encoded;
        handleExport(encoded);

        break;
      }
      default: {
        console.warn('Unhandled message type in sample recorder: ', evt.data.type);
      }
    }
  };

const getSampleRecorderSettings = (
  recordingStatus: RecordingStatus,
  setRecordingStatus: (newRecordingStatus: RecordingStatus) => void,
  awpNode: React.MutableRefObject<AudioWorkletNode | null>,
  recordingState: React.MutableRefObject<RecordingState>
) =>
  filterNils([
    {
      type: 'button',
      label: recordingStatus.type === 'recording' ? 'stop recording' : 'start recording',
      action:
        recordingStatus.type === 'recording'
          ? () => {
              if (!awpNode.current) {
                console.warn('Recording not started because AWP not started');
                return;
              }
              awpNode.current!.port.postMessage({ type: 'stopRecording' });

              setRecordingStatus({
                type: 'stopped',
                length: ctx.currentTime - recordingStatus.startTime,
                selectionStartMs: null,
                selectionEndMs: null,
              });
            }
          : () => {
              if (!awpNode.current) {
                console.warn('Recording not started because AWP not started');
                return;
              } else if (!recordingState.current.waveformRenderer.isInitialized()) {
                console.warn('Recording not started because waveform renderer is not initialized');
                return;
              }

              // Throw away previous recording context if there was one
              recordingState.current.waveformRenderer.reinitializeCtx();

              awpNode.current!.port.postMessage({ type: 'startRecording' });
              awpNode.current!.port.onmessage = mkHandleAWPMessage(recordingState.current);

              recordingState.current.lastWrittenChunkIx = -1;
              recordingState.current.unwrittenChunks = {};

              setRecordingStatus({
                type: 'recording',
                startTime: ctx.currentTime,
              });
            },
    },
    recordingStatus.type === 'stopped'
      ? {
          type: 'button',
          label: 'export recording',
          action: () => {
            if (!awpNode.current || !recordingState.current.waveformRenderer) {
              return;
            }
            awpNode.current!.port.postMessage({
              type: 'exportRecording',
              format: 0,
              // TODO: Switch to only export selection
              startSampleIx: 0,
              endSampleIx: recordingState.current.waveformRenderer.getSampleCount(),
            });
          },
        }
      : null,
  ]);

interface RecordingState {
  waveformRenderer: WaveformRenderer;
  unwrittenChunks: { [key: number]: Float32Array };
  lastWrittenChunkIx: number;
  reRender: (() => void) | null;
}

const buildDefaultRecordingState = (): RecordingState => ({
  waveformRenderer: new WaveformRenderer(),
  unwrittenChunks: {},
  lastWrittenChunkIx: -1,
  reRender: null,
});

const SampleRecorderInner: React.FC<{
  awpNode: React.MutableRefObject<AudioWorkletNode | null>;
}> = ({ awpNode }) => {
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus>({ type: 'notStarted' });
  const recordingState = useRef<RecordingState>(buildDefaultRecordingState());
  const settings = useMemo(
    () => getSampleRecorderSettings(recordingStatus, setRecordingStatus, awpNode, recordingState),
    [awpNode, recordingStatus]
  );

  return (
    <>
      <ControlPanel title='Sample Recorder Controls' settings={settings} />

      <SampleEditor waveformRenderer={recordingState.current.waveformRenderer} />
    </>
  );
};

interface SampleRecorderProps {
  vcId: string;
  awpNode: React.MutableRefObject<AudioWorkletNode | null>;
}

const SampleRecorder: React.FC<SampleRecorderProps> = ({ vcId, awpNode }) => {
  const inputConnected = useSelector((state: ReduxStore) =>
    state.viewContextManager.patchNetwork.connections.some(
      ([_src, dst]) => dst.vcId === vcId && dst.name === 'recording_input'
    )
  );

  if (!inputConnected) {
    return <NoInput />;
  }

  return <SampleRecorderInner awpNode={awpNode} />;
};

const WrappedSampleRecorder: React.FC<SampleRecorderProps> = ({ ...props }) => (
  <Provider store={store}>
    <div className='sample-recorder'>
      <h2>Sample Recorder</h2>
      <SampleRecorder {...props} />
    </div>
  </Provider>
);

export default WrappedSampleRecorder;
