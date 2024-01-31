import * as R from 'ramda';
import React, { useMemo, useRef } from 'react';
import ControlPanel from 'react-control-panel';
import { Provider, useSelector } from 'react-redux';

import './Equalizer.scss';
import { NEGATIVE_VALUE_DIVIDER_INTERVAL } from 'src/graphEditor/nodes/CustomAudio/Equalizer/Equalizer';
import { actionCreators, dispatch, store, type ReduxStore } from 'src/redux';
import { EQUALIZER_LEVEL_COUNT, type EqualizerPoint } from 'src/redux/modules/equalizer';
import { UnreachableError } from 'src/util';

interface EqualizerLineProps {
  points: EqualizerPoint[];
  width: number;
  height: number;
}

const EqualizerLine: React.FC<EqualizerLineProps> = ({ points, width, height }) => {
  const path = useMemo(
    () =>
      'M ' +
      points
        .map(({ x, y }) => `${x * width} ${(1 - y) * height}, ${x * width} ${(1 - y) * height}`)
        .join(' S '),
    [points, width, height]
  );

  return <path d={path} className='eq-line' />;
};

interface EqualizerKnobProps {
  vcId: string;
  x: number;
  y: number;
  index: number;
  pointCount: number;
  width: number;
  height: number;
  isManuallyControlled: boolean;
}

const EqualizerKnob: React.FC<EqualizerKnobProps> = ({
  vcId,
  x,
  y,
  index,
  width,
  height,
  pointCount,
  isManuallyControlled,
}) => (
  <>
    <circle
      className={`equalizer-knob${isManuallyControlled ? '' : ' equalizer-knob-disabled'}`}
      cx={x * width}
      cy={(1 - y) * height}
      r='10'
      onMouseDown={evt => {
        if (evt.button !== 0) {
          return;
        }

        const startClientX = evt.clientX;
        const startClientY = evt.clientY;

        const moveHandler = (evt: MouseEvent) => {
          const xDiff = evt.clientX - startClientX;
          const yDiff = -(evt.clientY - startClientY);

          dispatch(
            actionCreators.equalizer.UPDATE_POINT(vcId, {
              index,
              x: (x * width + xDiff) / width,
              y: R.clamp(0, 1, (y * height + yDiff) / height),
            })
          );
        };
        document.addEventListener('mousemove', moveHandler);
        // Register an event listener so we know when the drag stops
        document.addEventListener('mouseup', () =>
          document.removeEventListener('mousemove', moveHandler)
        );
      }}
      onContextMenu={
        isManuallyControlled
          ? evt => {
              if (index === 0 || index === pointCount - 1) {
                // Can't delete the end points
                return;
              }

              dispatch(actionCreators.equalizer.REMOVE_POINT(vcId, index));
              evt.preventDefault();
            }
          : undefined
      }
    />
    <text
      onContextMenu={evt => evt.preventDefault()}
      className='eq-knob-label'
      x={x * width - (index < 9 ? 4 : 6)}
      y={(1 - y) * height + 5}
    >
      {index + 1}
    </text>
  </>
);

interface EqualizerBackgroundInnerProps {
  width: number;
  height: number;
}

const EqualizerBackgroundInner: React.FC<EqualizerBackgroundInnerProps> = ({ width, height }) => (
  <>
    {/* bar indicating positive and negative values */}
    <line
      x1={0}
      x2={width}
      y1={(1 - NEGATIVE_VALUE_DIVIDER_INTERVAL) * height}
      y2={(1 - NEGATIVE_VALUE_DIVIDER_INTERVAL) * height}
      className='negative-value-divider-line'
    />
    {/* Divider lines between the underlying equalizer faders */}
    {R.range(0, 19).map(i => {
      const x = (width / 20) * (i + 1);
      return <line key={i} x1={x} x2={x} y1={0} y2={height} className='fader-divider-line' />;
    })}
  </>
);

const EqualizerBackground = React.memo(EqualizerBackgroundInner);

const dbToPercent = (db: number) => (db + 0.65 * 70) / 70;

interface EqualizerLevelsInnerProps {
  width: number;
  height: number;
  levels: Float32Array;
}

const EqualizerLevelsInner: React.FC<EqualizerLevelsInnerProps> = ({ width, height, levels }) => (
  <>
    {R.range(0, levels.length).map(i => (
      <rect
        key={i}
        x={(i / EQUALIZER_LEVEL_COUNT) * width}
        y={height - dbToPercent(levels[i]) * height}
        width={width / EQUALIZER_LEVEL_COUNT}
        height={dbToPercent(levels[i]) * height}
        className='eq-level'
      />
    ))}
  </>
);

const EqualizerLevels = React.memo(EqualizerLevelsInner);

interface EqualizerVizProps {
  vcId: string;
  height: number;
  width: number;
}

const EqualizerViz: React.FC<EqualizerVizProps> = ({ vcId, height, width }) => {
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
        dispatch(actionCreators.equalizer.ADD_POINT(vcId, x, 1 - y));
      }}
    >
      <EqualizerBackground width={width} height={height} />
      <EqualizerLevels width={width} height={height} levels={state.levels} />
      <EqualizerLine points={state.points} width={width} height={height} />
      {state.points.map(({ x, y, index, isManuallyControlled }) => (
        <EqualizerKnob
          key={index}
          vcId={vcId}
          x={x}
          y={y}
          isManuallyControlled={isManuallyControlled}
          index={index}
          width={width}
          height={height}
          pointCount={state.points.length}
        />
      ))}
    </svg>
  );
};

interface EqualizerControlPanelProps {
  vcId: string;
}

const EqualizerControlPanel: React.FC<EqualizerControlPanelProps> = ({ vcId }) => {
  const { smoothFactor, isBypassed } = useSelector((state: ReduxStore) => state.equalizer[vcId]);

  return (
    <ControlPanel
      settings={[
        { label: 'smooth factor', type: 'range', min: 0.8, max: 1 },
        { label: 'bypass', type: 'checkbox' },
      ]}
      style={{ width: '100%' }}
      state={{ 'smooth factor': smoothFactor, bypass: isBypassed }}
      onChange={(label: string, val: any, _state: any) => {
        switch (label) {
          case 'smooth factor': {
            dispatch(actionCreators.equalizer.SET_SMOOTH_FACTOR(vcId, val));
            break;
          }
          case 'bypass': {
            dispatch(actionCreators.equalizer.SET_IS_BYPASSED(vcId, val));
            break;
          }
          default: {
            throw new UnreachableError(
              `Unhandled equalizer small view control panel label: ${label}`
            );
          }
        }
      }}
    />
  );
};

interface EqualizerSmallViewProps {
  vcId: string;
}

const EqualizerSmallView: React.FC<EqualizerSmallViewProps> = ({ vcId }) => (
  <div>
    <Provider store={store}>
      <EqualizerViz vcId={vcId} width={500} height={300} />
      <EqualizerControlPanel vcId={vcId} />

      <div style={{ marginTop: 12, color: '#ff6666', padding: 4 }}>
        <strong>Warning:</strong> This equalizer created as an experiment, and it doesn&apos;t work
        very well (if it works at all). <br />
        <br />
        Consider using the &quot;Filter Designer&quot; for a modern, working replacement.
      </div>
    </Provider>
  </div>
);

export default EqualizerSmallView;
