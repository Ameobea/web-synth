/**
 * Analyzes the input signal and periodically samples it, recording statistics about the distribution of input signals.
 */
import { Map as ImmMap } from 'immutable';
import { buildActionGroup, buildModule, buildStore } from 'jantix';
import React, { Suspense } from 'react';

import type { ForeignNode } from 'src/graphEditor/nodes/CustomAudio/CustomAudio';
import Loading from 'src/misc/Loading';
import type { ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { mkContainerCleanupHelper, mkContainerRenderHelper } from 'src/reactUtils';
import { getSentry } from 'src/sentry';
import { AsyncOnce } from 'src/util';

const ctx = new AudioContext();

const StatisticsAWPRegistered = new AsyncOnce(
  () =>
    ctx.audioWorklet.addModule(
      process.env.ASSET_PATH +
        'StatisticsNodeProcessor.js?cacheBust=' +
        (window.location.host.includes('localhost') ? '' : btoa(Math.random().toString()))
    ),
  true
);

export type Settings = {
  framesToSample: number;
  bucketCount: number;
};
export type StatisticsNodeState = {
  data: { min: number; max: number; buckets: number[] };
};

const createReduxInfra = (initialState: StatisticsNodeState) => {
  const actionGroups = {
    SET_DATA: buildActionGroup({
      actionCreator: (data: StatisticsNodeState['data']) => ({ type: 'SET_DATA', data }),
      subReducer: (state: StatisticsNodeState, { data }) => ({ ...state, data }),
    }),
  };

  const reduxModule = buildModule<StatisticsNodeState, typeof actionGroups>(
    initialState,
    actionGroups
  );
  const modules = { statisticsNode: reduxModule };
  return buildStore<typeof modules>({ statisticsNode: reduxModule });
};

export type ReduxInfra = ReturnType<typeof createReduxInfra>;
export type ReduxStore = ReturnType<ReduxInfra['getState']>;

const Histogram = React.lazy(() => import('./StatisticsNodeUI'));
const LazyStatisticsNodeUI: React.FC = () => (
  <Suspense fallback={<Loading />}>
    <Histogram />
  </Suspense>
);

class StatisticsNode extends ConstantSourceNode implements ForeignNode {
  private vcId: string;
  private ctx: AudioContext;
  private framesToSample = 43;
  private bucketCount = 128;
  private reduxInfra: ReduxInfra;
  private workletHandle: AudioWorkletNode | null = null;
  private gainNode: GainNode;
  static typeName = 'Statistics Node';
  public nodeType = 'customAudio/statistics';

  public paramOverrides = {};

  constructor(ctx: AudioContext, vcId: string, params?: { [key: string]: any } | null) {
    super(ctx);
    this.start();
    this.offset.value = 0;

    this.vcId = vcId;
    this.ctx = ctx;
    this.gainNode = new GainNode(this.ctx);
    this.gainNode.gain.value = 0;

    if (params) {
      this.deserialize(params);
    }

    this.reduxInfra = createReduxInfra({ data: { min: 0, max: 0, buckets: [] } });

    this.initWorklet().catch(err => {
      console.error('Failed to initialize statistics node', err);
      getSentry()?.captureException(err);
    });

    this.renderSmallView = mkContainerRenderHelper({
      Comp: LazyStatisticsNodeUI,
      store: this.reduxInfra.store,
      // TODO: Look into whether or not this is bad for performance?
      predicate: () => this.gainNode.connect(this.ctx.destination),
      getProps: () => ({}),
    });

    this.cleanupSmallView = mkContainerCleanupHelper({
      predicate: () => {
        try {
          this.gainNode.disconnect(this.ctx.destination);
        } catch (_err) {
          /* pass */
        }
      },
      preserveRoot: true,
    });
  }

  private async initWorklet() {
    await StatisticsAWPRegistered.get();
    this.workletHandle = new AudioWorkletNode(this.ctx, 'statistics-node-processor', {
      channelInterpretation: 'discrete',
      channelCountMode: 'explicit',
    });
    this.connect((this.workletHandle.parameters as any).get('input'));
    this.workletHandle.connect(this.gainNode);

    this.workletHandle.port.onmessage = (msg: MessageEvent) => this.updateData(msg.data);
  }

  private updateData(data: StatisticsNodeState['data']) {
    this.reduxInfra.dispatch(this.reduxInfra.actionCreators.statisticsNode.SET_DATA(data));
  }

  private deserialize(params: { [key: string]: any }) {
    if (typeof params.samplesPerSecond === 'number') {
      this.framesToSample = params.framesToSample;
      this.bucketCount = params.bucketCount;
    }
  }

  public serialize() {
    return {
      framesToSample: this.framesToSample,
      bucketCount: this.bucketCount,
    };
  }

  public renderSmallView: ForeignNode['renderSmallView'] = undefined;
  public cleanupSmallView: ForeignNode['cleanupSmallView'] = undefined;

  public buildConnectables() {
    return {
      vcId: this.vcId,
      inputs: ImmMap<string, ConnectableInput>().set('input', {
        node: this.offset,
        type: 'number',
      }),
      outputs: ImmMap<string, ConnectableOutput>().set('passthru', { node: this, type: 'number' }),
      node: this,
    };
  }
}

export default StatisticsNode;
