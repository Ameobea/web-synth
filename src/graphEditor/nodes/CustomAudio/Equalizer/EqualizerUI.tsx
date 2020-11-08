import React, { useMemo, useRef } from 'react';
import { Provider, useSelector } from 'react-redux';
import { actionCreators, dispatch, ReduxStore, store } from 'src/redux';

import { EqualizerPoint } from 'src/redux/modules/equalizer';
import './Equalizer.scss';

const EqualizerLine: React.FC<{
  points: EqualizerPoint[];
  width: number;
  height: number;
}> = ({ points, width, height }) => {
  const path = useMemo(
    () =>
      'M ' +
      points
        .map(({ x, y }) => `${x * width} ${y * height}, ${x * width} ${y * height}`)
        .join(' S '),
    [points, width, height]
  );

  return <path d={path} className='eq-line' />;
};

const EqualizerKnob: React.FC<{
  vcId: string;
  x: number;
  y: number;
  index: number;
  pointCount: number;
  width: number;
  height: number;
}> = ({ vcId, x, y, index, width, height, pointCount }) => (
  <>
    <circle
      className='equalizer-knob'
      cx={x * width}
      cy={y * height}
      r='10'
      onMouseDown={evt => {
        if (evt.button !== 0) {
          return;
        }

        const startClientX = evt.clientX;
        const startClientY = evt.clientY;

        const moveHandler = (evt: MouseEvent) => {
          const xDiff = evt.clientX - startClientX;
          const yDiff = evt.clientY - startClientY;

          dispatch(
            actionCreators.equalizer.UPDATE_POINT(vcId, index, {
              x: (x * width + xDiff) / width,
              y: (y * height + yDiff) / height,
            })
          );
        };
        document.addEventListener('mousemove', moveHandler);
        // Register an event listener so we know when the drag stops
        document.addEventListener('mouseup', () =>
          document.removeEventListener('mousemove', moveHandler)
        );
      }}
      onContextMenu={evt => {
        if (index === 0 || index === pointCount - 1) {
          // Can't delete the end points
          return;
        }

        dispatch(actionCreators.equalizer.REMOVE_POINT(vcId, index));
        evt.preventDefault();
      }}
    />
    <text className='eq-knob-label' x={x * width - 4} y={y * height + 5}>
      {index + 1}
    </text>
  </>
);

const EqualizerViz: React.FC<{
  vcId: string;
  height: number;
  width: number;
}> = ({ vcId, height, width }) => {
  const state = useSelector((state: ReduxStore) => state.equalizer[vcId]);
  const svgRef = useRef<SVGSVGElement | null>(null);

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      className='equalizer'
      onDoubleClick={evt => {
        if (!svgRef) {
          console.error('SVG was double clicked before it was mounted???');
          return;
        }

        const svgClientRect = svgRef.current!.getBoundingClientRect();
        const x = (evt.clientX - svgClientRect.x) / width;
        const y = (evt.clientY - svgClientRect.y) / height;
        dispatch(actionCreators.equalizer.ADD_POINT(vcId, x, y));
      }}
    >
      <EqualizerLine points={state.points} width={width} height={height} />
      {state.points.map(({ x, y }, i) => (
        // eslint-disable-next-line react/jsx-key
        <EqualizerKnob
          vcId={vcId}
          x={x}
          y={y}
          index={i}
          width={width}
          height={height}
          pointCount={state.points.length}
        />
      ))}
    </svg>
  );
};

const EqualizerSmallView: React.FC<{
  vcId: string;
}> = ({ vcId }) => (
  <div>
    <Provider store={store}>
      <EqualizerViz vcId={vcId} width={500} height={300} />
    </Provider>
  </div>
);

export default EqualizerSmallView;
