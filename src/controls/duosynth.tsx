import * as React from 'react';
import * as R from 'ramda';
import ControlPanel, { Range } from 'react-control-panel';
import DuoSynth from 'tone/Tone/instrument/DuoSynth';

const getDefaultSettings = () => ({
  vibratoAmount: 0.5,
  vibratoRate: 5,
  harmonicity: 1.5,
  voice0: {
    volume: -10,
    portamento: 0,
    oscillator: {
      type: 'sine',
    },
    filterEnvelope: {
      attack: 0.01,
      decay: 0,
      sustain: 1,
      release: 0.5,
    },
    envelope: {
      attack: 0.01,
      decay: 0,
      sustain: 1,
      release: 0.5,
    },
  },
  voice1: {
    volume: -10,
    portamento: 0,
    oscillator: {
      type: 'sine',
    },
    filterEnvelope: {
      attack: 0.01,
      decay: 0,
      sustain: 1,
      release: 0.5,
    },
    envelope: {
      attack: 0.01,
      decay: 0,
      sustain: 1,
      release: 0.5,
    },
  },
});

const flatten = (obj, prefix = '') =>
  Object.entries(obj).reduce((acc, [key, val]) => {
    if (typeof val === 'object') {
      return { ...acc, ...flatten(val, `${prefix}${prefix ? '.' : ''}${key}`) };
    }
    return { ...acc, [`${prefix}${prefix ? '.' : ''}${key}`]: val };
  }, {});

const CompleteRange = ({ label, ...props }) => <Range path={label} label={label} {...props} />;

const initialState = flatten(getDefaultSettings());
console.log(initialState);

const cp = prefix => suffix => `${prefix}.${suffix}`;

const createEnvelopeConfig = prefix => {
  const p = cp(prefix);

  return [
    <CompleteRange key={p('attack')} label={p('attack')} min={0} max={10} />,
    <CompleteRange key={p('decay')} label={p('decay')} min={0} max={10} />,
    <CompleteRange key={p('sustain')} label={p('sustain')} min={0} max={10} />,
    <CompleteRange key={p('release')} label={p('release')} min={0} max={10} />,
  ];
};

const createVoiceConfig = prefix => {
  const p = cp(prefix);

  return [
    <CompleteRange key={p('volume')} label={p('volume')} min={-20} max={20} step={0.5} />,
    <CompleteRange key={p('portamento')} label={p('portamento')} min={0} max={10} />,
    ...createEnvelopeConfig(p('filterEnvelope')),
    ...createEnvelopeConfig(p('envelope')),
  ];
};

class DuoSynthControls extends React.Component {
  private synth: any;

  constructor(props) {
    super(props);
    this.synth = new DuoSynth(getDefaultSettings()).toMaster();
    this.state = {};
  }

  render() {
    return (
      <React.Fragment>
        <ControlPanel
          initialState={initialState}
          onChange={(key, val) => this.synth.set(key, parseFloat(val))}
          width={600}
          position="top-right"
        >
          <Range label="vibratoAmount" min={0} max={250} step={1.5} />
          <Range label="vibratoRate" min={0.5} max={6000} steps={250} scale="log" />
          <Range label="harmonicity" min={0.1} max={200} steps={250} scale="log" />
          {createVoiceConfig('voice0')}
          {createVoiceConfig('voice1')}
        </ControlPanel>
        <button onClick={() => this.synth.triggerAttack('C4', '2n')}>Trigger Attack</button>
      </React.Fragment>
    );
  }
}

export default DuoSynthControls;
