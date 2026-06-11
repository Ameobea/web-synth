import { Map as ImmMap } from 'immutable';

import type { LooperNode } from 'src/looper/LooperNode';
import type { AudioConnectables, ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { getState } from 'src/redux';
import { UnreachableError } from 'src/util';

export interface LooperCtx {
  looperNode: LooperNode;
}

export const LooperCtxsByVcId: Map<string, LooperCtx> = new Map();

export const get_looper_audio_connectables = (vcId: string): AudioConnectables => {
  const ctx = LooperCtxsByVcId.get(vcId);
  if (!ctx) {
    throw new UnreachableError('Missing state for looper vcId=' + vcId);
  }
  const moduleCount = getState().looper.stateByVcId[vcId].modules.length;

  return {
    vcId,
    inputs: ImmMap<string, ConnectableInput>(),
    outputs: new Array(moduleCount).fill(null).reduce((acc, _, moduleIx) => {
      const midiNode = ctx.looperNode.midiNodes[moduleIx];
      if (!midiNode) {
        return acc;
      }
      const moduleName = getState().looper.stateByVcId[vcId].modules[moduleIx].name;
      return acc.set(moduleName, { type: 'midi', node: midiNode });
    }, ImmMap<string, ConnectableOutput>()),
  };
};
