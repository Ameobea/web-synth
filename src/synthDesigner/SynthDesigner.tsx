import React, { useEffect, useRef } from 'react';
import { connect } from 'react-redux';
import { useOnce } from 'ameo-utils/util/react';

import { actionCreators, ReduxStore, dispatch } from 'src/redux';
import { SynthDesignerState, Waveform } from 'src/redux/modules/synthDesigner';
import './SynthDesigner.scss';

declare class WavyJones extends AnalyserNode {
  public lineColor: string;
  public lineThickness: number;
  constructor(ctx: AudioContext, nodeId: string);
}

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
      actionCreators.synthDesigner.SET_STATE(initialState);
    }
  });

  return (
    <>
      <div className='synth-designer'>
        <select
          value={synthDesignerState.waveform}
          onChange={evt =>
            dispatch(actionCreators.synthDesigner.SET_WAVEFORM(evt.target.value as Waveform))
          }
        >
          {Object.entries(Waveform).map(([key, value]) => (
            <option key={value} value={value}>
              {key}
            </option>
          ))}
        </select>
      </div>
      <div id='oscilloscope' ref={oscilloscopeNode}></div>
    </>
  );
};

export default connect(mapStateToProps)(SynthDesigner);
