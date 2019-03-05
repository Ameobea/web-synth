/**
 * Attack-Decay-Sustain-Release control for volume envelope shaping.  Rendered entirely on the JS
 * side with callbacks into Wasm for value changes.
 */

import * as React from 'react';
import { useState, useRef, Fragment } from 'react';
import { SVGAttributes } from 'react';
import { Value } from 'react-control-panel';

import { roundTo } from '../util';

export type ADSRValue = {
  // Number [0,1] indicating how far the level is from the left to the right
  pos: number;
  // Number [0,1] indicating at what level the value is from the bottom to the top
  magnitude: number;
};

export type ADSRValues = {
  attack: ADSRValue;
  decay: ADSRValue;
  release: ADSRValue;
};

export const defaultAdsrEnvelope: ADSRValues = {
  attack: { pos: 0.04, magnitude: 0.8 },
  decay: { pos: 0.14, magnitude: 0.35 },
  release: { pos: 0.9, magnitude: 0.35 },
};

type MousePos = { x: number; y: number };

const Handle = ({ x, y, onDrag, radius }) => {
  const setMousePos = evt => onDrag({ x: evt.clientX, y: evt.clientY });

  const handleMouseDown = evt => {
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
      stroke="#ccc"
      style={{ zIndex: 2, cursor: 'pointer' }}
      onMouseDown={handleMouseDown}
    />
  );
};

type ADSRControlPropTypes = {
  width: number;
  height: number;
  value: ADSRValues;
  onChange: (newValue: ADSRValues) => void;
  handleRadius?: number;
  style?: SVGAttributes<SVGSVGElement>['style'];
};

const clamp = (min, max, val) => Math.min(Math.max(val, min), max);

const ADSRSegment = ({ x1, y1, x2, y2, height }) => (
  <Fragment>
    <path
      d={`M${x1} ${height} L${x1} ${y1} L${x2} ${y2} L${x2} ${height} Z`}
      fill="#498"
      stroke="rgba(100,200,150,124)"
    />
    <line x1={x1} y1={y1} x2={x2} y2={y2} style={{ stroke: '#ccc' }} />
  </Fragment>
);

const ADSRControls = ({
  width,
  height,
  value,
  onChange,
  handleRadius = 6,
  style = {},
}: ADSRControlPropTypes) => {
  const svgElement = useRef<null | SVGSVGElement>(null);

  return (
    <svg style={{ backgroundColor: '#222', width, height, ...style }} ref={svgElement}>
      <ADSRSegment
        x1={0}
        y1={height}
        x2={value.attack.pos * width}
        y2={(1 - value.attack.magnitude) * height}
        height={height}
      />
      {['attack', 'decay', 'release'].map((key, i, keys) => {
        const x = value[key].pos * width;
        const y = (1 - value[key].magnitude) * height;
        const onDrag = ({ x, y }) => {
          const { top: yOffset, left: xOffset } = svgElement.current!.getBoundingClientRect();

          const pos = (x - xOffset) / width;
          const magnitude = 1 - (y - yOffset) / height;

          // Avoid setting a pos lower than that of the previous setting or higher than the next
          // setting (if they exist).
          const previousPos = i === 0 ? 0.0 : value[keys[i - 1]].pos;
          const nextPos = i === keys.length - 1 ? 1.0 : value[keys[i + 1]].pos;
          const clampedPos = clamp(previousPos, nextPos, pos);

          // Lock the magnitudes of decay and release
          const otherKey: string | undefined = {
            decay: 'release',
            release: 'decay',
          }[key];
          const updatedValue = { pos: clampedPos, magnitude };
          const updatedValues = !!otherKey
            ? { [otherKey]: { ...value[otherKey], magnitude }, [key]: updatedValue }
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

export const ControlPanelADSR = ({ value, onChange, theme }) => (
  <Fragment>
    <span style={{ paddingTop: 4 }}>
      <Value text={formatAdsrValue(value)} width={225} />
    </span>
    <ADSRControls width={350} height={200} value={value} onChange={onChange} />
  </Fragment>
);

export default ADSRControls;
