/**
 * Attack-Decay-Sustain-Release control for volume envelope shaping.  Rendered entirely on the JS
 * side with callbacks into Wasm for value changes.
 */
import React, { Fragment, type SVGAttributes, useMemo, useRef } from 'react';
import { Value } from 'react-control-panel';

import { clamp, roundTo } from '../util';

export interface ADSRValue {
  // Number [0,1] indicating how far the level is from the left to the right
  pos: number;
  // Number [0,1] indicating at what level the value is from the bottom to the top
  magnitude: number;
}

export interface ADSRValues {
  attack: ADSRValue;
  decay: ADSRValue;
  release: ADSRValue;
}

export const buildDefaultAdsrEnvelope = (): ADSRValues => ({
  attack: { pos: 0.01, magnitude: 0.55 },
  decay: { pos: 0.14, magnitude: 0.5 },
  release: { pos: 0.94, magnitude: 0.5 },
});

interface MousePos {
  x: number;
  y: number;
}

interface HandleProps {
  x: number;
  y: number;
  onDrag: (pos: MousePos) => void;
  radius: number;
}

const Handle: React.FC<HandleProps> = ({ x, y, onDrag, radius }) => {
  const setMousePos: (evt: MouseEvent) => void = evt => onDrag({ x: evt.clientX, y: evt.clientY });

  const handleMouseDown: (evt: React.MouseEvent<SVGCircleElement, MouseEvent>) => void = () => {
    window.addEventListener('mousemove', setMousePos);
    window.addEventListener('mouseup', () => window.removeEventListener('mousemove', setMousePos), {
      once: true,
    });
  };

  return (
    <circle
      cx={x}
      cy={y}
      r={radius}
      stroke='#ccc'
      style={{ zIndex: 2, cursor: 'pointer' }}
      onMouseDown={handleMouseDown}
    />
  );
};

interface ADSRControlPropTypes {
  width: number;
  height: number;
  value: ADSRValues;
  onChange: (newValue: ADSRValues) => void;
  handleRadius?: number;
  style?: SVGAttributes<SVGSVGElement>['style'];
}

interface ADSRSegmentProps {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  height: number;
}

const ADSRSegment = ({ x1, y1, x2, y2, height }: ADSRSegmentProps) => (
  <>
    <path
      d={`M${x1} ${height} L${x1} ${y1} L${x2} ${y2} L${x2} ${height} Z`}
      fill='#498'
      stroke='rgba(100,200,150,124)'
    />
    <line x1={x1} y1={y1} x2={x2} y2={y2} style={{ stroke: '#ccc' }} />
  </>
);

const ADSRControls: React.FC<ADSRControlPropTypes> = ({
  width,
  height,
  value,
  onChange,
  handleRadius = 6,
  style,
}) => {
  console.error('This component is deprecated; use ADSR2 instead');
  const svgElement = useRef<null | SVGSVGElement>(null);
  const combinedStyle = useMemo(
    () => ({
      backgroundColor: '#1b1b1b',
      border: '1px solid #444',
      marginTop: 3,
      width,
      height,
      ...(style ?? {}),
    }),
    [height, style, width]
  );

  return (
    <svg className='adsr-viz' style={combinedStyle} ref={svgElement}>
      <ADSRSegment
        x1={0}
        y1={height}
        x2={value.attack.pos * width}
        y2={(1 - value.attack.magnitude) * height}
        height={height}
      />
      {['attack' as const, 'decay' as const, 'release' as const].map((key, i, keys) => {
        const x = value[key].pos * width;
        const y = (1 - value[key].magnitude) * height;
        const onDrag: (pos: MousePos) => void = ({ x, y }) => {
          const { top: yOffset, left: xOffset } = svgElement.current!.getBoundingClientRect();

          const pos = (x - xOffset) / width;
          const magnitude = clamp(0, 1, 1 - (y - yOffset) / height);

          // Avoid setting a pos lower than that of the previous setting or higher than the next
          // setting (if they exist).
          const previousPos = i === 0 ? 0.0 : value[keys[i - 1]].pos;
          const nextPos = i === keys.length - 1 ? 1.0 : value[keys[i + 1]].pos;
          const clampedPos = clamp(previousPos, nextPos, pos);

          // Lock the magnitudes of decay and release
          const otherKey: 'release' | 'decay' | undefined = {
            decay: 'release' as const,
            release: 'decay' as const,
            attack: undefined,
          }[key];
          const updatedValue = { pos: clampedPos, magnitude };
          const updatedValues = !!otherKey
            ? {
                [otherKey]: { ...value[otherKey], magnitude },
                [key]: updatedValue,
              }
            : { [key]: updatedValue };

          onChange({ ...value, ...updatedValues });
        };
        const nextKey = i < keys.length - 1 ? keys[i + 1] : null;

        return (
          <Fragment key={key}>
            <ADSRSegment
              x1={x}
              y1={y}
              x2={!!nextKey ? value[nextKey].pos * width : width}
              y2={!!nextKey ? (1 - value[nextKey].magnitude) * height : height}
              height={height}
            />

            <Handle key={key} x={x} y={y} onDrag={onDrag} radius={handleRadius} />
          </Fragment>
        );
      })}
    </svg>
  );
};

const formatAdsrValue = ({ attack, decay, release }: ADSRValues): string =>
  [attack.pos, decay.pos - attack.pos, decay.magnitude, release.pos]
    .map(val => roundTo(val, 3))
    .join(' - ');

interface ControlPanelADSRProps {
  value: ADSRValues;
  onChange: (newValue: ADSRValues) => void;
  theme: { [key: string]: any };
}

export const ControlPanelADSR: React.FC<ControlPanelADSRProps> = ({ value, onChange }) => (
  <>
    <span style={{ paddingTop: 4 }}>
      <Value text={formatAdsrValue(value)} width={225} />
    </span>
    <ADSRControls width={350} height={200} value={value} onChange={onChange} />
  </>
);

export default React.memo(ADSRControls);
