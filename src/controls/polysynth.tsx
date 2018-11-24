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

class DuoSynthControls extends React.Component {
  private synth: any;

  constructor(props) {
    super(props);
    this.synth = (window as any).SYNTH;
  }

  render() {
    return (
      <React.Fragment>
        <ControlPanel
          onChange={(key, val) => {
            switch (key) {
              case 'bitcrusher': {
                this.synth.disconnect();
                if (val) {
                  this.synth.connect(bitcrusher);
                } else {
                  this.synth.toMaster();
                }
              }
              default: {
                const parsed = parseFloat(val);
                this.synth.voices.forEach(voice => voice.set(key, isNaN(parsed) ? val : parsed));
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
            { type: 'range', label: 'envelope.attack', min: 0, max: 2, initial: 0.005, steps: 300 },
            { type: 'range', label: 'envelope.decay', min: 0, max: 2, initial: 0.1 },
            { type: 'range', label: 'envelope.sustain', min: 0, max: 2, initial: 0.3 },
            { type: 'range', label: 'envelope.release', min: 0, max: 2, initial: 1.0 },
            { type: 'checkbox', label: 'bitcrusher', initial: true },
          ]}
        />
      </React.Fragment>
    );
  }
}

export default DuoSynthControls;
