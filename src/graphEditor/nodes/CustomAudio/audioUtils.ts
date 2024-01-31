import { Map } from 'immutable';

import type { OverridableAudioParam } from 'src/graphEditor/nodes/util';
import type { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';

const ctx = new AudioContext();

export const getMicrophoneStream = (): Promise<MediaStream> =>
  new Promise((fulfill, reject) => {
    if ((navigator as any).getUserMedia) {
      (navigator as any).getUserMedia({ audio: true }, fulfill, reject);
    } else {
      fulfill(navigator.mediaDevices.getUserMedia({ audio: true }));
    }
  });

const micNode = new GainNode(ctx);

let didConnectMic = false;
const maybeConnectMicNode = async () => {
  if (didConnectMic) {
    return;
  }

  try {
    const stream = await getMicrophoneStream();
    ctx.createMediaStreamSource(stream).connect(micNode);
    console.log('Connected microphone stream to patch network');
    didConnectMic = true;
  } catch (err) {
    console.error('Error getting microphone stream', err);
  }
};

/**
 * This is a custom node type that we use to facilitate initializing the patch network and everything else synchronously while also having
 * to asynchronously initialize the mic stream due to user permissions dialog etc.
 *
 * This node will always exist staticly, and then we asynchronously initialize the mic media stream and connect it to this.
 */
export class MicNode extends GainNode {
  public nodeType = 'customAudio/microphone';
  static typeName = 'Microphone';
  public vcId: string;

  /**
   * See the docs for `enhanceAudioNode`.
   */
  public paramOverrides: {
    [name: string]: { param: OverridableAudioParam; override: ConstantSourceNode };
  } = {};

  public constructor(ctx: AudioContext, vcId: string) {
    super(ctx);
    this.vcId = vcId;

    maybeConnectMicNode();

    micNode.connect(this);
  }

  public serialize() {
    return {};
  }

  public buildConnectables(): AudioConnectables & { node: MicNode } {
    return {
      vcId: this.vcId,
      inputs: Map<string, ConnectableInput>(),
      outputs: Map<string, ConnectableOutput>().set('output', { node: this, type: 'customAudio' }),
      node: this,
    };
  }
}
