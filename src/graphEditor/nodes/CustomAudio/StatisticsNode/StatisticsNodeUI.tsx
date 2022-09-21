import { useUniqueId } from 'ameo-utils/util/react';
import * as Chartist from 'chartist';
import 'chartist/dist/chartist.min.css';
import React, { useEffect, useRef } from 'react';
import { useSelector } from 'react-redux';

import { ReduxStore } from '.';

const Histogram: React.FC = () => {
  const { data } = useSelector((state: ReduxStore) => ({ data: state.statisticsNode.data }));
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
  }, [histogramContainer, histogramContainerId]);

  useEffect(() => {
    if (!chartHandle.current) {
      return;
    }

    chartHandle.current.update({ series: [data.buckets] });
  }, [chartHandle, data]);

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

export default Histogram;
