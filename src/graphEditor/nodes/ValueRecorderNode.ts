import { retryAsync } from 'src/util';

/**
 * Implements an audio node that pulls values out of the webaudio context up into the JS context.
 *
 * Every frame, it records the most recent value it received on its input and stores it as a
 * variable in JS.  This can then be retrieved as needed.
 */
export interface ValueRecorder extends AudioParam {
  lastValue: number;
}

let recorderIsRegistered: boolean | Promise<void> = false;
const registerRecorder = async (ctx: AudioContext) => {
  if (recorderIsRegistered === true) {
    return;
  } else if (recorderIsRegistered !== false) {
    await recorderIsRegistered;
    return;
  }

  const prom = retryAsync(() =>
    ctx.audioWorklet.addModule(
      process.env.ASSET_PATH +
        'ValueRecorderWorkletProcessor.js?cacheBust=' +
        btoa(Math.random().toString())
    )
  );
  recorderIsRegistered = prom;
  await prom;
  recorderIsRegistered = true;
};

export const createValueRecorder = async (
  ctx: AudioContext,
  defaultValue: number
): Promise<ValueRecorder> => {
  await registerRecorder(ctx);
  const workletHandle = new AudioWorkletNode(ctx, 'value-recorder-audio-worklet-node-processor', {
    numberOfInputs: 0,
    numberOfOutputs: 0,
    channelCount: 1,
    channelInterpretation: 'discrete',
    channelCountMode: 'explicit',
  });

  const param: ValueRecorder = (workletHandle.parameters as any).get('input');
  param.lastValue = defaultValue;

  workletHandle.port.onmessage = msg => {
    param.lastValue = msg.data;
  };
  return param;
};
