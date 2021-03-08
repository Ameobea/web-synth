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

  const prom = ctx.audioWorklet.addModule(
    '/ValueRecorderWorkletProcessor.js?cacheBust=' + btoa(Math.random().toString())
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
  const workletHandle = new AudioWorkletNode(ctx, 'value-recorder-audio-worklet-node-processor');

  const param: ValueRecorder = (workletHandle.parameters as any).get('input');
  param.lastValue = defaultValue;

  workletHandle.port.onmessage = msg => {
    if (msg.data !== 0) {
      console.log(msg.data);
    }
    param.lastValue = msg.data;
  };
  return param;
};
