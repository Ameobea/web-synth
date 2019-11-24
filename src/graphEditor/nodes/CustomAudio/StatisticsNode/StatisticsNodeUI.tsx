import React, { useRef, useEffect, Suspense } from 'react';
import { connect } from 'react-redux';
import ControlPanel from 'react-control-panel';
import 'chartist/dist/chartist.min.css';

import { ReduxInfra, Settings, ReduxStore } from '.';

const mapHistogramStateToProps = (state: ReduxStore) => ({ data: state.statisticsNode.data });
const HistogramInner: React.FC<{ Chartist: typeof import('chartist') } & ReturnType<
  typeof mapHistogramStateToProps
>> = ({ data, Chartist }) => {
  const histogramContainer = useRef<null | HTMLDivElement>(null);
  useEffect(() => {
    if (!histogramContainer.current) {
      return;
    }

    new Chartist.Bar('#histogram', { series: [data.buckets] }, { high: data.max, low: data.min });
  }, [histogramContainer, Chartist.Bar, data]);

  return <div id='histogram' ref={histogramContainer} />;
};
const ConnectedHistogram = connect(mapHistogramStateToProps)(HistogramInner);
const Histogram = React.lazy(() =>
  import('chartist').then(Chartist => {
    const InnerHistogram: React.FC<{}> = () => <ConnectedHistogram Chartist={Chartist} />;
    return {
      default: InnerHistogram,
    };
  })
);

const mapControlsStateToProps = (state: ReduxStore) => ({
  settings: state.statisticsNode.settings,
});
const ControlsInner: React.FC<{ onChange: (newSettings: Settings) => void } & ReturnType<
  typeof mapControlsStateToProps
>> = ({ settings, onChange }) => (
  <ControlPanel
    state={settings}
    settings={[
      {
        type: 'range',
        label: 'framesToSample',
        min: 5,
        max: 200,
        step: 1,
      },
      {
        type: 'range',
        label: 'bucketCount',
        min: 2,
        max: 800,
        step: 1,
      },
    ]}
    onChange={(_key: string, _val: number, state: Settings) => onChange(state)}
  />
);
const Controls = connect(mapControlsStateToProps)(ControlsInner);

const StatisticsNodeUI: React.FC<{
  actionCreators: ReduxInfra['actionCreators'];
  dispatch: ReduxInfra['dispatch'];
  onChange: (settings: Settings) => void;
}> = ({ actionCreators, dispatch, onChange }) => (
  <div>
    <Suspense fallback={<>Loading...</>}>
      <Histogram />
    </Suspense>

    <Controls
      onChange={(settings: Settings) => {
        dispatch(actionCreators.statisticsNode.SET_SETTINGS(settings));
        onChange(settings);
      }}
    />
  </div>
);

export default StatisticsNodeUI;
