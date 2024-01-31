import { FAUST_COMPILER_ENDPOINT } from 'src/conf';
import type { faustEditorContextMap } from 'src/faustEditor';
import type { DynamicCodeWorkletNode } from 'src/faustEditor/DymanicCodeWorkletNode';
import { UnreachableError, type ValueOf } from 'src/util';

export default class SoulAudioWorklet extends AudioWorkletNode implements DynamicCodeWorkletNode {
  private jsonDef: any;

  constructor(audioContext: AudioContext, moduleId: string, workletNameOverride?: string) {
    super(audioContext, workletNameOverride ? workletNameOverride : `soul-awp-${moduleId}`);
  }

  public init(
    dspArrayBuffer: ArrayBuffer,
    _args?: {
      customMessageHandler?: (msg: MessageEvent) => void;
      context?: ValueOf<typeof faustEditorContextMap>;
    }
  ): Promise<DynamicCodeWorkletNode> {
    return new Promise(resolve => {
      this.port.onmessage = (evt: MessageEvent) => {
        switch (evt.data.type) {
          case 'jsonDef': {
            this.jsonDef = evt.data.jsonDef;
            resolve(this);
            break;
          }
          default: {
            console.error('Unhandled event from soul AWP: ', evt.data);
          }
        }
      };

      this.port.postMessage({ type: 'init', dspArrayBuffer });
    });
  }

  public getParamSettings(
    paramDefaultValues?: { [paramName: string]: number },
    _setParamValue?: (key: string, val: number) => void
  ) {
    if (!this.jsonDef) {
      throw new UnreachableError(
        'Tried to get param settings for soul worklet before initialization'
      );
    }

    return this.jsonDef.parameters.map((param: any) => ({
      ...param.properties,
      label: param.id,
      address: param.id,
      defaultValue: paramDefaultValues?.[param.id] ?? param.properties.init,
      defaultVal: paramDefaultValues?.[param.id] ?? param.properties.init,
      initial: paramDefaultValues?.[param.id] ?? param.properties.init,
      type: 'range',
    }));
  }

  public shutdown() {
    this.port.postMessage({ type: 'shutdown' });
  }
}

export const buildSoulWorkletNode = async (
  audioContext: AudioContext,
  dspArrayBuffer: ArrayBuffer,
  moduleID: string,
  context: ValueOf<typeof faustEditorContextMap>
): Promise<DynamicCodeWorkletNode> => {
  const faustModuleURL = `${FAUST_COMPILER_ENDPOINT}/soul/SoulAWP.js?id=${moduleID}`;
  await audioContext.audioWorklet.addModule(faustModuleURL);

  const node = new SoulAudioWorklet(audioContext, moduleID);

  // Send the Wasm module over to the created worklet's thread via message passing so that it can instantiate it over
  // there and control it directly
  return node.init(dspArrayBuffer, { context });
};
