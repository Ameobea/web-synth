/**
 * Attack-Decay-Sustain-Release control for volume envelope shaping.  Rendered entirely on the JS
 * side with callbacks into Wasm for value changes.
 */

import * as React from 'react';
import { useState, useRef, Fragment } from 'react';
import { SVGAttributes } from 'react';
import keys from 'ramda/es/keys';

const styles = {
  root: {
    backgroundColor: '#222',
  },
};

type MousePos = { x: number; y: number };

const Handle = ({ x, y, onDrag }) => {
  const setMousePos = evt => onDrag({ x: evt.clientX, y: evt.clientY });

  const handleMouseDown = evt => {
    window.addEventListener('mousemove', setMousePos);
    window.addEventListener('mouseup', () => window.removeEventListener('mousemove', setMousePos), {
      once: true,
    });
  };

  return (
    <circle cx={x} cy={y} r={6} stroke="#ccc" style={{ zIndex: 2 }} onMouseDown={handleMouseDown} />
  );
};

type ADSRValue = {
  // Number [0,1] indicating how far the level is from the left to the right
  pos: number;
  // Number [0,1] indicating at what level the value is from the bottom to the top
  magnitude: number;
};

type ADSRValues = {
  attack: ADSRValue;
  decay: ADSRValue;
  sustain: ADSRValue;
  release: ADSRValue;
};

type ADSRControlPropTypes = {
  width: number;
  height: number;
  value: ADSRValues;
  onChange: (newValue: ADSRValues) => void;
  style?: SVGAttributes<SVGSVGElement>['style'];
};

const clamp = (min, max, val) => Math.min(Math.max(val, min), max);

const ADSRControls = ({ width, height, value, onChange, style = {} }: ADSRControlPropTypes) => {
  const svgElement = useRef<null | SVGSVGElement>(null);

  return (
    <svg style={{ ...styles.root, width, height, ...style }} ref={svgElement}>
      {['attack', 'decay', 'sustain', 'release'].map((key, i, keys) => {
        const x = value[key].pos * width;
        const y = value[key].magnitude * height;
        const onDrag = ({ x, y }) => {
          const { top: yOffset, left: xOffset } = svgElement.current!.getBoundingClientRect();

          const pos = (x - xOffset) / width;
          const magnitude = (y - yOffset) / height;

          // Avoid setting a pos lower than that of the previous setting or higher than the next
          // setting (if they exist).
          const previousPos = i === 0 ? 0.0 : value[keys[i - 1]].pos;
          const nextPos = i === keys.length - 1 ? 1.0 : value[keys[i + 1]].pos;
          const clampedPos = clamp(previousPos, nextPos, pos);

          onChange({ ...value, [key]: { pos: clampedPos, magnitude } });
        };
        const nextKey = i < keys.length - 1 ? keys[i + 1] : null;

        return (
          <Fragment>
            <Handle key={key} x={x} y={y} onDrag={onDrag} />
            {!!nextKey ? (
              <line
                x1={x}
                y1={y}
                x2={value[nextKey].pos * width}
                y2={value[nextKey].magnitude * height}
                style={{ stroke: '#ccc' }}
              />
            ) : null}
          </Fragment>
        );
      })}
    </svg>
  );
};

export default ADSRControls;
