export declare class WavyJones extends AnalyserNode {
  public lineColor: string;
  public lineThickness: number;
  public animationFrameHandle: number;
  constructor(ctx: AudioContext, nodeId: string, overrideWidth: number, overrideHeight: number);
}

export const buildWavyJonesInstance = (
  ctx: AudioContext,
  nodeID: string,
  width: number,
  height: number
) => {
  const wavyJonesInstance = new WavyJones(ctx, nodeID, width, height);

  wavyJonesInstance.lineColor = '#FFF';
  wavyJonesInstance.lineThickness = 1.2;
  return wavyJonesInstance;
};
