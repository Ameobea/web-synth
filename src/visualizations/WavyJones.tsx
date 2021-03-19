export declare class WavyJones extends AnalyserNode {
  public lineColor: string;
  public lineThickness: number;
  public animationFrameHandle: number;
  constructor(
    ctx: AudioContext,
    nodeId: string,
    updateIntervalMs?: number,
    overrideWidth?: number,
    overrideHeight?: number
  );
}

export const buildWavyJonesInstance = (
  ctx: AudioContext,
  nodeID: string,
  overrideWidth?: number,
  overrideHeight?: number
) => {
  const wavyJonesInstance = new WavyJones(ctx, nodeID, 40, overrideWidth, overrideHeight);

  wavyJonesInstance.lineColor = '#FFF';
  wavyJonesInstance.lineThickness = 1.2;
  return wavyJonesInstance;
};
