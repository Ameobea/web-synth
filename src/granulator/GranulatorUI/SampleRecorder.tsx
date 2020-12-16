import { filterNils, PropTypesOf, UnreachableException } from 'ameo-utils';
import React, { useMemo, useRef, useState } from 'react';
import { Provider } from 'react-redux';
import ControlPanel from 'react-control-panel';

import { ReduxStore, store, useSelector } from 'src/redux';
import SampleEditor, { WaveformInstance } from 'src/granulator/GranulatorUI/SampleEditor';

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
    const inst = recordingState.waveformRendererInstance;
    if (!inst) {
      return;
    }

    const ctxPtr = recordingState.waveformRendererCtxPtr?.current;
    if (ctxPtr === null || ctxPtr === undefined) {
      return;
    }

    switch (evt.data.type) {
      case 'recordingBlock': {
        if (evt.data.index === recordingState.lastWrittenChunkIx + 1) {
          // We received an in-order chunk; write it into the samples buffer directly
          recordingState.totalWrittenSamples = inst.instance.append_samples_to_waveform(
            ctxPtr,
            evt.data.block
          );
          recordingState.lastWrittenChunkIx += 1;

          recordingState.boundsRef!.current.endMs =
            (recordingState.totalWrittenSamples / 44100) * 1000;
          recordingState.reRender!();
          return;
        }

        // TODO: Handle out-of-order chunks

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
              const bounds = recordingState.current.boundsRef;
              if (!bounds) {
                throw new UnreachableException('Bounds should have been set by now');
              }
              if (bounds.current.endMs === 0) {
                bounds.current.startMs = 0;
                bounds.current.endMs = (ctx.currentTime - recordingStatus.startTime) * 1000;
              }

              setRecordingStatus({
                type: 'stopped',
                length: ctx.currentTime - recordingStatus.startTime,
                selectionStartMs: null,
                selectionEndMs: null,
              });
            }
          : () => {
              if (
                !awpNode.current ||
                !recordingState.current.waveformRendererInstance ||
                !recordingState.current.waveformRendererCtxPtr
              ) {
                return;
              }
              awpNode.current!.port.postMessage({ type: 'startRecording' });
              awpNode.current!.port.onmessage = mkHandleAWPMessage(recordingState.current);

              if (recordingState.current.waveformRendererCtxPtr.current !== null) {
                recordingState.current.waveformRendererInstance.instance.free_waveform_renderer_ctx(
                  recordingState.current.waveformRendererCtxPtr.current
                );
              }
              recordingState.current.waveformRendererCtxPtr.current = recordingState.current.waveformRendererInstance.instance.create_waveform_renderer_ctx(
                0,
                44100,
                1400,
                240
              );
              recordingState.current.totalWrittenSamples = 0;
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
            if (!awpNode.current || !recordingState.current.waveformRendererInstance) {
              return;
            }
            awpNode.current!.port.postMessage({
              type: 'exportRecording',
              format: 0,
              // TODO: Switch to only export selection
              startSampleIx: (recordingState.current.boundsRef!.current.startMs / 1000) * 44100,
              endSampleIx: (recordingState.current.boundsRef!.current.endMs / 1000) * 44100,
            });
          },
        }
      : null,
  ]);

interface RecordingState {
  waveformRendererInstance: {
    type: 'loaded';
    instance: typeof import('src/waveform_renderer');
    memory: typeof import('src/waveform_renderer_bg').memory;
  } | null;
  unwrittenChunks: { [key: number]: Float32Array };
  waveformRendererCtxPtr: React.MutableRefObject<number | null> | null;
  lastWrittenChunkIx: number;
  totalWrittenSamples: number;
  boundsRef: React.MutableRefObject<{
    startMs: number;
    endMs: number;
  }> | null;
  reRender: (() => void) | null;
}

const buildDefaultRecordingState = (): RecordingState => ({
  waveformRendererInstance: null,
  unwrittenChunks: {},
  waveformRendererCtxPtr: null,
  lastWrittenChunkIx: -1,
  totalWrittenSamples: 0,
  boundsRef: null,
  reRender: null,
});

const SampleRecorderInner: React.FC<{
  awpNode: React.MutableRefObject<AudioWorkletNode | null>;
}> = ({ awpNode }) => {
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus>({ type: 'notStarted' });
  const recordingState = useRef<RecordingState>(buildDefaultRecordingState());
  const [{ startMarkPosMs, endMarkPosMs }, setMarkPositions] = useState<{
    startMarkPosMs: number | null;
    endMarkPosMs: number | null;
  }>({
    startMarkPosMs: null,
    endMarkPosMs: null,
  });
  const settings = useMemo(
    () => getSampleRecorderSettings(recordingStatus, setRecordingStatus, awpNode, recordingState),
    [awpNode, recordingStatus]
  );

  return (
    <>
      <ControlPanel title='Sample Recorder Controls' settings={settings} />

      <SampleEditor
        startMarkPosMs={startMarkPosMs}
        endMarkPosMs={endMarkPosMs}
        onMarkPositionsChanged={setMarkPositions}
        sample={(
          inst: WaveformInstance,
          waveformRendererCtxPtr: React.MutableRefObject<number | null>,
          bounds: React.MutableRefObject<{
            startMs: number;
            endMs: number;
          }>,
          reRender?: () => void
        ): { length: number; sampleRate: number } => {
          recordingState.current.boundsRef = bounds;
          if (reRender) {
            recordingState.current.reRender = reRender;
          }
          recordingState.current.waveformRendererCtxPtr = waveformRendererCtxPtr;

          if (inst.type === 'loaded') {
            recordingState.current.waveformRendererInstance = inst;
          } else {
            return { length: 0, sampleRate: 44100 };
          }

          return { length: recordingState.current.totalWrittenSamples, sampleRate: 44100 };
        }}
      />
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
