import { BarChart } from 'chartist';

import 'chartist/dist/index.css';
import React, { useEffect, useRef } from 'react';
import { shallowEqual, useSelector } from 'react-redux';

import type { ReduxStore } from '.';
import { useUniqueId } from 'src/reactUtils';

const Histogram: React.FC = () => {
  const { data } = useSelector(
    (state: ReduxStore) => ({ data: state.statisticsNode.data }),
    shallowEqual
  );
  const histogramContainer = useRef<null | HTMLDivElement>(null);
  const chartHandle = useRef<BarChart | null>(null);

  const uniqueId = useUniqueId();
  const histogramContainerId = `histogram-${uniqueId}`;

  useEffect(() => {
    if (!histogramContainer.current) {
      return;
    }

    chartHandle.current = new BarChart(`#${histogramContainerId}`, { series: [] }, {});
    return () => void chartHandle.current!.detach();
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
