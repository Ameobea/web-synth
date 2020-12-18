import { filterNils, PropTypesOf } from 'ameo-utils';
import React, { useMemo, useRef, useState } from 'react';
import { Provider } from 'react-redux';
import ControlPanel from 'react-control-panel';

import { ReduxStore, store, useSelector } from 'src/redux';
import SampleEditor from 'src/granulator/GranulatorUI/SampleEditor';
import { WaveformRenderer } from 'src/granulator/GranulatorUI/WaveformRenderer';

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
        // TODO
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
              if (!awpNode.current || !recordingState.current.waveformRenderer.isInitialized()) {
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

const SampleRecorder: React.FC<{
  vcId: string;
  awpNode: React.MutableRefObject<AudioWorkletNode | null>;
}> = ({ vcId, awpNode }) => {
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

const WrappedSampleRecorder: React.FC<PropTypesOf<typeof SampleRecorder>> = ({ ...props }) => (
  <Provider store={store}>
    <div className='sample-recorder'>
      <h2>Sample Recorder</h2>
      <SampleRecorder {...props} />
    </div>
  </Provider>
);

export default WrappedSampleRecorder;
