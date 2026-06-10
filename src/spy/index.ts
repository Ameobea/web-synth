import type { AudioConnectables } from 'src/patchNetwork';
import { MIDINode } from 'src/patchNetwork/midiNode';
import { MIDIEventType, postMIDIEventToAudioThread, startAll, stopAll } from 'src/eventScheduler';
import { OverridableAudioNode, OverridableAudioParam } from 'src/graphEditor/nodes/util';
import { getState } from 'src/redux';
import { fetchAndLoadSharedComposition } from 'src/persistance';
import { retryAsync } from 'src/util';
import {
  getEqualizerInstance,
  listEqualizerVcIds,
  persist_equalizer,
  type EqualizerBand,
  type EqualizerState,
} from 'src/equalizer/equalizer';
import { EqualizerFilterType } from 'src/equalizer/eqHelpers';

const ctx = new AudioContext();

export interface TapHandle {
  vcId: string;
  portName: string;
  node: AudioWorkletNode;
  src: AudioNode;
  buffers: Float32Array[][];
  channelCount: number;
  sampleRate: number;
  detached: boolean;
}

let workletReady: Promise<void> | null = null;
const ensureWorklet = () => {
  if (!workletReady) {
    workletReady = retryAsync(() =>
      ctx.audioWorklet.addModule(
        process.env.ASSET_PATH + 'TapAWP.js?cb=' + btoa(Math.random().toString())
      )
    );
  }
  return workletReady;
};

const allConnectables = () => getState().viewContextManager.patchNetwork.connectables;

const findConnectables = (vcIdOrType: string): AudioConnectables | null => {
  const map = allConnectables();
  const direct = map.get(vcIdOrType);
  if (direct) {
    return direct;
  }
  const matches: AudioConnectables[] = [];
  for (const [, c] of map) {
    const t = c.node?.nodeType;
    if (t && (t === vcIdOrType || t.endsWith('/' + vcIdOrType) || t.includes(vcIdOrType))) {
      matches.push(c);
    }
  }
  if (matches.length === 0) {
    return null;
  }
  if (matches.length > 1) {
    console.warn(
      `[spy] '${vcIdOrType}' matched ${matches.length} nodes; using first. Pass a vcId for an exact match.`,
      matches.map(c => ({ vcId: c.vcId, type: c.node?.nodeType }))
    );
  }
  return matches[0];
};

export interface NodeInfo {
  vcId: string;
  type: string;
  inputs: { name: string; type: string; isAudioParam: boolean }[];
  outputs: { name: string; type: string }[];
}

export const listNodes = (): NodeInfo[] =>
  [...allConnectables().values()].map(c => ({
    vcId: c.vcId,
    type: c.node?.nodeType ?? 'viewContext',
    inputs: [...c.inputs.entries()].map(([name, i]) => ({
      name,
      type: i.type,
      isAudioParam:
        i.node instanceof OverridableAudioParam ||
        i.node instanceof OverridableAudioNode ||
        typeof (i.node as AudioParam).setValueAtTime === 'function',
    })),
    outputs: [...c.outputs.entries()].map(([name, o]) => ({ name, type: o.type })),
  }));

export const tap = async (vcIdOrType: string, portName = 'output'): Promise<TapHandle> => {
  await ensureWorklet();
  const conn = findConnectables(vcIdOrType);
  if (!conn) {
    throw new Error(`[spy] No node matching '${vcIdOrType}'`);
  }
  const out = conn.outputs.get(portName);
  if (!out) {
    throw new Error(
      `[spy] Node '${conn.vcId}' has no output '${portName}'; available: ${[...conn.outputs.keys()].join(', ')}`
    );
  }
  if (!(out.node instanceof AudioNode)) {
    throw new Error(`[spy] Output '${portName}' is not an AudioNode (type=${out.type})`);
  }

  const node = new AudioWorkletNode(ctx, 'tap-awp', {
    numberOfInputs: 1,
    numberOfOutputs: 0,
  });
  const handle: TapHandle = {
    vcId: conn.vcId,
    portName,
    node,
    src: out.node,
    buffers: [],
    channelCount: 0,
    sampleRate: ctx.sampleRate,
    detached: false,
  };
  node.port.onmessage = e => {
    if (e.data?.type !== 'chunks') {
      return;
    }
    for (const frame of e.data.chunks as Float32Array[][]) {
      if (frame.length > handle.channelCount) {
        while (handle.buffers.length < frame.length) {
          handle.buffers.push([]);
        }
        handle.channelCount = frame.length;
      }
      for (let c = 0; c < frame.length; c++) {
        handle.buffers[c].push(frame[c]);
      }
    }
  };
  out.node.connect(node);
  return handle;
};

export const drain = (h: TapHandle): Promise<void> =>
  new Promise(resolve => {
    const prev = h.node.port.onmessage!;
    h.node.port.onmessage = e => {
      prev.call(h.node.port, e);
      if (e.data?.type === 'chunks') {
        h.node.port.onmessage = prev;
        resolve();
      }
    };
    h.node.port.postMessage({ type: 'drain' });
  });

export const untap = (h: TapHandle) => {
  if (h.detached) {
    return;
  }
  h.detached = true;
  try {
    h.src.disconnect(h.node);
  } catch (e) {
    console.warn('[spy] disconnect failed:', e);
  }
  h.node.port.postMessage({ type: 'stop' });
};

export const read = (h: TapHandle): Float32Array[] =>
  h.buffers.map(chunks => {
    const total = chunks.reduce((s, a) => s + a.length, 0);
    const out = new Float32Array(total);
    let off = 0;
    for (const a of chunks) {
      out.set(a, off);
      off += a.length;
    }
    return out;
  });

export interface CaptureResult {
  channels: Float32Array[];
  sampleRate: number;
}

export const capture = async (
  vcIdOrType: string,
  portName: string,
  durationSec: number
): Promise<CaptureResult> => {
  const h = await tap(vcIdOrType, portName);
  await new Promise(r => setTimeout(r, durationSec * 1000));
  await drain(h);
  untap(h);
  return { channels: read(h), sampleRate: h.sampleRate };
};

const paramTarget = (node: AudioParam | AudioNode | unknown): AudioParam | null => {
  if (node instanceof OverridableAudioParam) {
    node.setIsOverridden(true);
    return node.manualControl.offset;
  }
  if (node instanceof OverridableAudioNode) {
    node.setIsOverridden(true);
    return node.manualControl.offset;
  }
  if (node && typeof (node as AudioParam).setValueAtTime === 'function') {
    return node as AudioParam;
  }
  return null;
};

export const setParam = (vcIdOrType: string, name: string, value: number, whenSec = 0) => {
  const conn = findConnectables(vcIdOrType);
  if (!conn) {
    throw new Error(`[spy] No node matching '${vcIdOrType}'`);
  }
  const inp = conn.inputs.get(name);
  if (!inp) {
    throw new Error(
      `[spy] Node '${conn.vcId}' has no input '${name}'; available: ${[...conn.inputs.keys()].join(', ')}`
    );
  }
  const target = paramTarget(inp.node);
  if (!target) {
    throw new Error(`[spy] Input '${name}' is not a settable param (type=${inp.type})`);
  }
  target.setValueAtTime(value, ctx.currentTime + whenSec);
};

export const loadComposition = (id: string | number, force = true) =>
  fetchAndLoadSharedComposition(String(id), force, false);

const findMidiNode = (vcIdOrType: string, portName: string, side: 'input' | 'output'): MIDINode => {
  const conn = findConnectables(vcIdOrType);
  if (!conn) {
    throw new Error(`[spy] No node matching '${vcIdOrType}'`);
  }
  const map = side === 'output' ? conn.outputs : conn.inputs;
  const port = map.get(portName);
  if (!port) {
    throw new Error(
      `[spy] Node '${conn.vcId}' has no ${side} '${portName}'; available: ${[...map.keys()].join(', ')}`
    );
  }
  if (!(port.node instanceof MIDINode)) {
    throw new Error(
      `[spy] ${side} '${portName}' on '${conn.vcId}' is not MIDI (type=${port.type})`
    );
  }
  return port.node;
};

export const triggerAttack = (vcIdOrType: string, port: string, note: number, velocity = 100) =>
  findMidiNode(vcIdOrType, port, 'output').onAttack(note, velocity);

export const triggerRelease = (vcIdOrType: string, port: string, note: number, velocity = 0) =>
  findMidiNode(vcIdOrType, port, 'output').onRelease(note, velocity);

export const triggerNote = async (
  vcIdOrType: string,
  port: string,
  note: number,
  velocity = 100,
  durationSec = 0.5
) => {
  const midi = findMidiNode(vcIdOrType, port, 'output');
  midi.onAttack(note, velocity);
  await new Promise(r => setTimeout(r, durationSec * 1000));
  midi.onRelease(note, 0);
};

export const clearAllMidi = (vcIdOrType: string, port: string) =>
  findMidiNode(vcIdOrType, port, 'output').clearAll();

export const encodeWav = (channels: Float32Array[], sampleRate: number): Uint8Array => {
  const numCh = channels.length || 1;
  const numFrames = channels[0]?.length ?? 0;
  const blockAlign = numCh * 4;
  const dataSize = numFrames * blockAlign;
  const buf = new ArrayBuffer(44 + dataSize);
  const dv = new DataView(buf);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) {
      dv.setUint8(off + i, s.charCodeAt(i));
    }
  };
  writeStr(0, 'RIFF');
  dv.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 3, true);
  dv.setUint16(22, numCh, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * blockAlign, true);
  dv.setUint16(32, blockAlign, true);
  dv.setUint16(34, 32, true);
  writeStr(36, 'data');
  dv.setUint32(40, dataSize, true);
  let off = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numCh; c++) {
      dv.setFloat32(off, channels[c][i], true);
      off += 4;
    }
  }
  return new Uint8Array(buf);
};

export const saveWav = (
  channelsOrResult: Float32Array | Float32Array[] | CaptureResult,
  filename = 'capture.wav',
  sampleRate?: number
) => {
  let channels: Float32Array[];
  let sr: number;
  if (!Array.isArray(channelsOrResult) && !(channelsOrResult instanceof Float32Array)) {
    channels = channelsOrResult.channels;
    sr = channelsOrResult.sampleRate;
  } else {
    channels = channelsOrResult instanceof Float32Array ? [channelsOrResult] : channelsOrResult;
    sr = sampleRate ?? ctx.sampleRate;
  }
  const blob = new Blob([encodeWav(channels, sr) as BlobPart], { type: 'audio/wav' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const captureWav = async (
  vcIdOrType: string,
  portName: string,
  durationSec: number,
  filename = 'capture.wav'
) => {
  const res = await capture(vcIdOrType, portName, durationSec);
  saveWav(res, filename);
  return res;
};

const resolveEqVcId = (vcId?: string): string => {
  if (vcId) {
    return vcId;
  }
  const all = listEqualizerVcIds();
  if (all.length === 0) {
    throw new Error('[spy] No equalizer instances found');
  }
  if (all.length > 1) {
    throw new Error(`[spy] ${all.length} equalizers present; pass vcId. Found: ${all.join(', ')}`);
  }
  return all[0];
};

const requireEq = (vcId?: string) => {
  const id = resolveEqVcId(vcId);
  const inst = getEqualizerInstance(id);
  if (!inst) {
    throw new Error(`[spy] No equalizer instance for vcId '${id}'`);
  }
  return { id, inst };
};

export const getEqState = (vcId?: string): EqualizerState => requireEq(vcId).inst.serialize();

export const setEqBand = (
  bandIxOrOpts: number | { vcId?: string; bandIx: number; band: Partial<EqualizerBand> },
  partial?: Partial<EqualizerBand>
) => {
  let vcId: string | undefined;
  let bandIx: number;
  let band: Partial<EqualizerBand>;
  if (typeof bandIxOrOpts === 'number') {
    bandIx = bandIxOrOpts;
    band = partial ?? {};
  } else {
    vcId = bandIxOrOpts.vcId;
    bandIx = bandIxOrOpts.bandIx;
    band = bandIxOrOpts.band;
  }
  const { inst } = requireEq(vcId);
  const cur = inst.serialize().bands[bandIx];
  if (!cur) {
    throw new Error(`[spy] Equalizer band ${bandIx} does not exist`);
  }
  inst.setBand(bandIx, { ...cur, ...band });
};

export const setEqBands = (
  bandsOrOpts: Partial<EqualizerBand>[] | { vcId?: string; bands: Partial<EqualizerBand>[] }
) => {
  const vcId = Array.isArray(bandsOrOpts) ? undefined : bandsOrOpts.vcId;
  const bands = Array.isArray(bandsOrOpts) ? bandsOrOpts : bandsOrOpts.bands;
  const { inst } = requireEq(vcId);
  const cur = inst.serialize().bands;
  bands.forEach((b, i) => {
    if (!cur[i]) {
      throw new Error(`[spy] Equalizer band ${i} does not exist`);
    }
    inst.setBand(i, { ...cur[i], ...b });
  });
};

export const persistEq = (vcId?: string) => {
  const id = resolveEqVcId(vcId);
  persist_equalizer(`equalizer_${id}`);
};

export const installSpy = () => {
  (window as any).__webSynthSpy = {
    ctx,
    listNodes,
    tap,
    drain,
    untap,
    read,
    capture,
    captureWav,
    setParam,
    loadComposition,
    encodeWav,
    saveWav,
    triggerAttack,
    triggerRelease,
    triggerNote,
    clearAllMidi,
    postMIDIEventToAudioThread,
    MIDIEventType,
    startAll,
    stopAll,
    getEqState,
    setEqBand,
    setEqBands,
    persistEq,
    EqualizerFilterType,
  };
};
