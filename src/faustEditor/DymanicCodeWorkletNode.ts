import type { ValueOf } from 'ameo-utils';

import type { faustEditorContextMap } from 'src/faustEditor';

export declare class DynamicCodeWorkletNode extends AudioWorkletNode {
  constructor(ctx: AudioContext, moduleId: string, workletNameOverride?: string);

  public getParamSettings(
    paramDefaultValues?: { [paramName: string]: number },
    setParamValue?: (key: string, val: number) => void
  ): any[];

  public init(
    dspArrayBuffer: ArrayBuffer,
    args?: {
      customMessageHandler?: (msg: MessageEvent) => void;
      context?: ValueOf<typeof faustEditorContextMap>;
    }
  ): Promise<DynamicCodeWorkletNode>;

  public shutdown(): void;
}
