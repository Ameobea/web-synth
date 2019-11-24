/**
 * Analyzes the input signal and periodically samples it, recording statistics about the distribution of input signals.
 */

import React from 'react';
import ReactDOM from 'react-dom';
import { Map } from 'immutable';

import { ForeignNode } from 'src/graphEditor/nodes/CustomAudio/CustomAudio';
import { buildStore, buildActionGroup, buildModule } from 'jantix';
import { ConnectableInput, ConnectableOutput } from 'src/patchNetwork';
import { Provider } from 'react-redux';
import StatisticsNodeUI from 'src/graphEditor/nodes/CustomAudio/StatisticsNode/StatisticsNodeUI';

export type Settings = {
  framesToSample: number;
  bucketCount: number;
};
export type StatisticsNodeState = {
  settings: Settings;
  data: { min: number; max: number; buckets: number[] };
};

const createReduxInfra = (initialState: StatisticsNodeState) => {
  const actionGroups = {
    SET_SETTINGS: buildActionGroup({
      actionCreator: (settings: Settings) => ({ type: 'SET_SETTINGS', settings }),
      subReducer: (state: StatisticsNodeState, { settings }) => ({ ...state, settings }),
    }),
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

class StatisticsNode extends ConstantSourceNode implements ForeignNode {
  private vcId: string;
  private ctx: AudioContext;
  private framesToSample = 43;
  private bucketCount = 128;
  private reduxInfra: ReduxInfra;
  private workletHandle: AudioWorkletNode | null = null;
  private gn: GainNode;
  public name = 'Statistics Node';
  public nodeType = 'customAudio/statistics';

  public paramOverrides = {};

  constructor(ctx: AudioContext, vcId: string, params?: { [key: string]: any } | null) {
    super(ctx);
    this.start();
    this.offset.value = 0;

    this.vcId = vcId;
    this.ctx = ctx;
    this.gn = new GainNode(this.ctx);
    this.gn.gain.value = 0;

    if (params) {
      this.deserialize(params);
    }

    this.reduxInfra = createReduxInfra({
      settings: { framesToSample: this.framesToSample, bucketCount: this.bucketCount },
      data: { min: 0, max: 0, buckets: [] },
    });

    this.initWorklet();
  }

  private async initWorklet() {
    await this.ctx.audioWorklet.addModule('/StatisticsNodeProcessor.js');
    this.workletHandle = new AudioWorkletNode(this.ctx, 'statistics-node-processor');
    this.connect((this.workletHandle.parameters as any).get('input'));
    this.workletHandle.connect(this.gn);

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

  public renderSmallView(domId: string) {
    const node = document.getElementById(domId);
    if (!node) {
      console.error(
        `Tried to render small view with id ${domId} but no element with that ID exists in the DOM`
      );
      return;
    }

    this.gn.connect(this.ctx.destination);

    ReactDOM.render(
      <Provider store={this.reduxInfra.store}>
        <StatisticsNodeUI
          actionCreators={this.reduxInfra.actionCreators}
          dispatch={this.reduxInfra.dispatch}
          onChange={({ bucketCount, framesToSample }: Settings) => {
            this.bucketCount = bucketCount;
            this.framesToSample = framesToSample;
          }}
        />
      </Provider>,
      node
    );
  }

  public cleanupSmallView(domId: string) {
    const node = document.getElementById(domId);
    if (!node) {
      console.error(
        `Tried to clean up small view with id ${domId} but no element with that ID exists in the DOM`
      );
      return;
    }

    this.gn.disconnect(this.ctx.destination);

    ReactDOM.unmountComponentAtNode(node);
  }

  public buildConnectables() {
    return {
      vcId: this.vcId,
      inputs: Map<string, ConnectableInput>().set('input', { node: this.offset, type: 'number' }),
      outputs: Map<string, ConnectableOutput>().set('passthru', { node: this, type: 'number' }),
      node: this,
    };
  }
}

export default StatisticsNode;
