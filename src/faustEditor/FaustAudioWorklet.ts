import { ValueOf } from 'ameo-utils';
import * as R from 'ramda';

import { FAUST_COMPILER_ENDPOINT } from 'src/conf';
import { faustEditorContextMap } from 'src/faustEditor';
import { mapUiGroupToControlPanelFields } from 'src/faustEditor/uiBuilder';

export class FaustWorkletNode extends AudioWorkletNode {
  constructor(audioContext: AudioContext, moduleId: string, workletNameOverride?: string) {
    super(
      audioContext,
      workletNameOverride ? workletNameOverride : `faust-worklet-processor-${moduleId}`
    );
  }

  public pathTable: { [path: string]: number } = {};
  private fPitchwheelLabel: unknown[] = [];
  private fCtrlLabel: unknown[][] = new Array(128).fill(null).map(() => []);

  // bar graph
  private inputsItems: unknown[] = [];
  private outputsItems: unknown[] = [];

  public jsonDef!: { [key: string]: any };

  public parseUi = (jsonDef: any) => {
    jsonDef.ui.forEach((group: any) => this.parseUiGroup(group));
    this.jsonDef = jsonDef;
    return this.pathTable;
  };

  private parseUiGroup = (group: any) => (group.items ? this.parseUiItems(group.items) : null);
  private parseUiItems = (items: any) => items.forEach((item: any) => this.parseUiItem(item));
  private parseUiItem = (item: any) => {
    if (item.type === 'vgroup' || item.type === 'hgroup' || item.type === 'tgroup') {
      this.parseUiItems(item.items);
    } else if (item.type === 'hbargraph' || item.type === 'vbargraph') {
      // Keep bargraph adresses
      this.outputsItems.push(item.address);
      this.pathTable[item.address] = parseInt(item.index);
    } else if (
      item.type === 'vslider' ||
      item.type === 'hslider' ||
      item.type === 'button' ||
      item.type === 'checkbox' ||
      item.type === 'nentry'
    ) {
      // Keep inputs adresses
      this.inputsItems.push(item.address);
      this.pathTable[item.address] = parseInt(item.index);
      if (!item.meta) {
        return;
      }

      item.meta.forEach((meta: any) => {
        const midi = meta.midi;
        if (!midi) {
          return;
        }
        const strMidi = midi.trim();

        if (strMidi === 'pitchwheel') {
          this.fPitchwheelLabel.push(item.address);
        } else {
          const matched = strMidi.match(/^ctrl\s(\d+)/);
          if (!matched) return;
          this.fCtrlLabel[parseInt(matched[1])].push({
            path: item.address,
            min: parseFloat(item.min),
            max: parseFloat(item.max),
          });
        }
      });
    }
  };

  public init(
    dspArrayBuffer: ArrayBuffer,
    {
      customMessageHandler,
      context,
    }: {
      customMessageHandler?: (msg: MessageEvent) => void;
      context?: ValueOf<typeof faustEditorContextMap>;
    } = {}
  ): Promise<FaustWorkletNode> {
    return new Promise(resolve => {
      this.port.onmessage = (msg: MessageEvent) => {
        if (typeof msg.data === 'object') {
          if (msg.data.jsonDef) {
            let allDefaultParamsAreZero = false;
            if (context) {
              // We set default values onto the node's params in order to allow the node to function
              // while things initialize.
              const uiItems = msg.data.jsonDef.ui as any[];
              const settings = R.flatten(
                uiItems.map(item =>
                  mapUiGroupToControlPanelFields(item, () => void 0, context.paramDefaultValues)
                )
              ) as any[];
              settings.forEach(setting => {
                const targetParam = (this.parameters as any).get(setting.address);
                targetParam.value = setting.initial;
              });
              allDefaultParamsAreZero = settings.every(R.propEq('initial', 0));
            }

            const pathTable = this.parseUi(msg.data.jsonDef);
            this.port.postMessage({ type: 'setPathTable', pathTable, allDefaultParamsAreZero });
            resolve(this);
          } else if (msg.data.log) {
            console.log(...msg.data.log);
          } else if (customMessageHandler) {
            customMessageHandler(msg);
          }
        }
      };

      this.port.postMessage({ type: 'init', dspArrayBuffer });
    });
  }

  public shutdown() {
    this.port.postMessage({ type: 'shutdown' });
  }
}

export const buildFaustWorkletNode = async (
  audioContext: AudioContext,
  dspArrayBuffer: ArrayBuffer,
  moduleID: string,
  context: ValueOf<typeof faustEditorContextMap>
): Promise<FaustWorkletNode> => {
  const faustModuleURL = `${FAUST_COMPILER_ENDPOINT}/FaustAudioWorkletProcessor.js?id=${moduleID}`;
  await audioContext.audioWorklet.addModule(faustModuleURL);

  const node = new FaustWorkletNode(audioContext, moduleID);

  // Send the Wasm module over to the created worklet's thread via message passing so that it can instantiate it over
  // there and control it directly
  return node.init(dspArrayBuffer, { context });
};
