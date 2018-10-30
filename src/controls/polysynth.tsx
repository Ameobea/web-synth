import * as React from 'react';
import * as R from 'ramda';
import ControlPanel, { Range } from 'react-control-panel';

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

  state = {};

  render() {
    return (
      <React.Fragment>
        <ControlPanel
          onChange={(key, val) => {
            const parsed = parseFloat(val);
            this.synth.voices.forEach(voice => voice.set(key, isNaN(parsed) ? val : parsed));
          }}
          width={600}
          position="top-right"
          settings={[
            {
              type: 'select',
              label: 'oscillator.type',
              options: ['sine', 'square', 'triangle', 'sawtooth'],
              initial: 'sine',
            },
            {
              type: 'range',
              label: 'envelope.attack',
              min: 0.005,
              max: 10,
              initial: 0.005,
              scale: 'log',
              steps: 100,
            },
            {
              type: 'range',
              label: 'envelope.decay',
              min: 0.005,
              max: 10,
              initial: 0.1,
              scale: 'log',
              steps: 100,
            },
            {
              type: 'range',
              label: 'envelope.sustain',
              min: 0.005,
              max: 10,
              initial: 0.3,
              scale: 'log',
              steps: 100,
            },
            {
              type: 'range',
              label: 'envelope.release',
              min: 0.005,
              max: 10,
              initial: 1.0,
              scale: 'log',
              steps: 100,
            },
          ]}
        />
        <button onClick={() => this.synth.triggerAttack('C4', '2n')}>Trigger Attack</button>
      </React.Fragment>
    );
  }
}

export default DuoSynthControls;
