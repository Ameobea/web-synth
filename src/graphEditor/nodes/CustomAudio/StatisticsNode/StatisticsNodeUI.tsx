import React, { useRef, useEffect, Suspense } from 'react';
import { connect } from 'react-redux';
import 'chartist/dist/chartist.min.css';
import { useUniqueId } from 'ameo-utils/util/react';

import { ReduxStore } from '.';
import Loading from 'src/misc/Loading';

const mapHistogramStateToProps = (state: ReduxStore) => ({ data: state.statisticsNode.data });
const HistogramInner: React.FC<
  { Chartist: typeof import('chartist') } & ReturnType<typeof mapHistogramStateToProps>
> = ({ data, Chartist }) => {
  const histogramContainer = useRef<null | HTMLDivElement>(null);
  const chartHandle = useRef<Chartist.IChartistBarChart | null>(null);

  const uniqueId = useUniqueId();
  const histogramContainerId = `histogram-${uniqueId}`;

  useEffect(() => {
    if (!histogramContainer.current) {
      return;
    }

    chartHandle.current = new Chartist.Bar(`#${histogramContainerId}`, { series: [] }, {});
    return () => chartHandle.current!.detach();
  }, [histogramContainer, Chartist.Bar, histogramContainerId]);

  useEffect(() => {
    if (!chartHandle.current) {
      return;
    }

    chartHandle.current.update({ series: [data.buckets] });
  }, [chartHandle, Chartist.Bar, data]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <p>Min: {data.min}</p>
      <p>Max: {data.max}</p>
      <div
        id={histogramContainerId}
        style={{ backgroundColor: '#fff', display: 'flex', flexBasis: 300 }}
        ref={histogramContainer}
      />
    </div>
  );
};
const ConnectedHistogram = connect(mapHistogramStateToProps)(HistogramInner);
const Histogram = React.lazy(() =>
  import('chartist').then(Chartist => {
    const InnerHistogram: React.FC = () => <ConnectedHistogram Chartist={Chartist} />;
    return { default: InnerHistogram };
  })
);

const StatisticsNodeUI: React.FC = () => (
  <Suspense fallback={<Loading />}>
    <Histogram />
  </Suspense>
);

export default StatisticsNodeUI;
