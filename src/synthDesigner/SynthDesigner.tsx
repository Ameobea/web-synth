import React, { useEffect, useRef } from 'react';
import { connect } from 'react-redux';
import { useOnce } from 'ameo-utils/util/react';

import { actionCreators, ReduxStore, dispatch } from 'src/redux';
import { SynthDesignerState, Waveform, SynthModule } from 'src/redux/modules/synthDesigner';
import './SynthDesigner.scss';

declare class WavyJones extends AnalyserNode {
  public lineColor: string;
  public lineThickness: number;
  constructor(ctx: AudioContext, nodeId: string);
}

const SynthModuleComp: React.FC<{ index: number; synth: SynthModule }> = ({ index, synth }) => {
  return (
    <div className='synth-module'>
      <div
        className='synth-remove-button'
        onClick={() => dispatch(actionCreators.synthDesigner.DELETE_SYNTH_MODULE(index))}
      >
        X
      </div>
      <select
        value={synth.waveform}
        onChange={evt =>
          dispatch(actionCreators.synthDesigner.SET_WAVEFORM(index, evt.target.value as Waveform))
        }
      >
        {Object.entries(Waveform).map(([key, value]) => (
          <option key={value} value={value}>
            {key}
          </option>
        ))}
      </select>
    </div>
  );
};

const mapStateToProps = ({ synthDesigner }: ReduxStore) => ({ synthDesignerState: synthDesigner });

const SynthDesigner: React.FC<
  {
    initialState?: SynthDesignerState | null;
  } & ReturnType<typeof mapStateToProps>
> = ({ initialState, synthDesignerState }) => {
  const oscilloscopeNode = useRef<HTMLDivElement | null>(null);
  const wavyJonesInstance = useRef<WavyJones | null>(null);

  useEffect(() => {
    if (!oscilloscopeNode.current || wavyJonesInstance.current) {
      return;
    }

    wavyJonesInstance.current = new WavyJones(new AudioContext(), 'oscilloscope');

    wavyJonesInstance.current.lineColor = '#FFF';
    wavyJonesInstance.current.lineThickness = 1.2;
  });

  useOnce(() => {
    if (initialState) {
      dispatch(actionCreators.synthDesigner.SET_STATE(initialState));
    }
  });

  return (
    <>
      <div className='synth-designer'>
        {synthDesignerState.synths.map((synth, i) => (
          <SynthModuleComp key={i} synth={synth} index={i} />
        ))}
        <button
          style={{ marginTop: 6 }}
          onClick={() => dispatch(actionCreators.synthDesigner.ADD_SYNTH_MODULE())}
        >
          Add Synth Module
        </button>
      </div>
      <div id='oscilloscope' ref={oscilloscopeNode}></div>
    </>
  );
};

export default connect(mapStateToProps)(SynthDesigner);
