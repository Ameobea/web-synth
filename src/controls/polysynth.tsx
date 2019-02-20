import * as React from 'react';
import * as R from 'ramda';
import ControlPanel, { Range } from 'react-control-panel';

import { bitcrusher } from '../chords';

const flatten = (obj, prefix = '') =>
  Object.entries(obj).reduce((acc, [key, val]) => {
    if (typeof val === 'object') {
      return { ...acc, ...flatten(val, `${prefix}${prefix ? '.' : ''}${key}`) };
    }
    return { ...acc, [`${prefix}${prefix ? '.' : ''}${key}`]: val };
  }, {});

const PolySynthControls = ({ synth }) => (
  <ControlPanel
    onChange={(key, val) => {
      switch (key) {
        case 'bitcrusher': {
          synth.disconnect();
          if (val) {
            synth.connect(bitcrusher);
          } else {
            synth.toMaster();
          }
        }
        default: {
          const parsed = parseFloat(val);
          synth.voices.forEach(voice => voice.set(key, isNaN(parsed) ? val : parsed));
        }
      }
    }}
    width={400}
    position="top-right"
    draggable
    settings={[
      { type: 'range', label: 'volume', min: -20, max: 20, initial: 0, steps: 200 },
      {
        type: 'select',
        label: 'oscillator.type',
        options: ['sine', 'square', 'triangle', 'sawtooth'],
        initial: 'sine',
      },
      { type: 'checkbox', label: 'bitcrusher', initial: true },
    ]}
  />
);

export default PolySynthControls;
