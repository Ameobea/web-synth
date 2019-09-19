class FaustWorkletNode extends AudioWorkletNode {
  constructor(audioContext: AudioContext) {
    super(audioContext, 'faust-worklet-processor');
  }

  private pathTable: { [path: string]: number } = {};
  private fPitchwheelLabel: unknown[] = [];
  private fCtrlLabel: unknown[][] = new Array(128).fill(null).map(() => []);

  // bar graph
  private inputsItems: unknown[] = [];
  private outputsItems: unknown[] = [];

  public jsonDef: { [key: string]: any };

  public parseUi = jsonDef => {
    jsonDef.ui.forEach(group => this.parseUiGroup(group));
    this.jsonDef = jsonDef;
    return this.pathTable;
  };

  private parseUiGroup = group => (group.items ? this.parseUiItems(group.items) : null);
  private parseUiItems = items => items.forEach(item => this.parseUiItem(item));
  private parseUiItem = item => {
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

      item.meta.forEach(meta => {
        const midi = meta.midi;
        if (!midi) return;
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

  public setParamValue = (path: string, val: number) =>
    this.port.postMessage({ type: 'setParamValue', path, val });
}

export const buildFaustWorkletNode = async (
  audioContext: AudioContext,
  dspArrayBuffer: ArrayBuffer
): Promise<FaustWorkletNode> => {
  await audioContext.audioWorklet.addModule('./FaustAudioWorkletProcessor.js');

  const node = new FaustWorkletNode(audioContext);

  // Send the Wasm module over to the created worklet's thread via message passing so that it can instantiate it over
  // there and control it directly
  return await new Promise(resolve => {
    node.port.onmessage = (msg: MessageEvent) => {
      if (typeof msg.data === 'object') {
        if (msg.data.jsonDef) {
          const pathTable = node.parseUi(msg.data.jsonDef);
          node.port.postMessage({ type: 'setPathTable', pathTable });
          resolve(node);
        } else if (msg.data.log) {
          console.log(...msg.data.log);
        }
      }
    };

    node.port.postMessage({ type: 'init', dspArrayBuffer });
  });
};
