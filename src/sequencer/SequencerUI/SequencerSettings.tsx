import React, { useMemo } from 'react';
import { connect } from 'react-redux';
import ControlPanel from 'react-control-panel';

import { SequencerReduxState, SequencerReduxInfra } from 'src/sequencer/redux';

const mapStateToProps = (state: { sequencer: SequencerReduxState }) => ({
  bpm: state.sequencer.bpm,
  isPlaying: state.sequencer.playingStatus.type === 'PLAYING',
});

const mkHandleChange = ({
  dispatch,
  actionCreators,
}: {
  actionCreators: SequencerReduxInfra['actionCreators'];
  dispatch: SequencerReduxInfra['dispatch'];
}) => (key: string, val: any, _state: { [key: string]: any }) => {
  switch (key) {
    case 'bpm': {
      dispatch(actionCreators.sequencer.SET_BPM(val));
      break;
    }
    default: {
      console.error(`Unhandled key in SequencerSettings: "${key}"`);
    }
  }
};

const SequencerSettings: React.FC<{
  actionCreators: SequencerReduxInfra['actionCreators'];
  dispatch: SequencerReduxInfra['dispatch'];
} & ReturnType<typeof mapStateToProps>> = ({ bpm, isPlaying, actionCreators, dispatch }) => {
  const state = useMemo(() => ({ bpm }), [bpm]);
  const settings = useMemo(
    () => [
      {
        type: 'range',
        label: 'bpm',
        min: 0,
        max: 600,
        initial: 120,
        steps: 200,
      },
      {
        type: 'button',
        label: isPlaying ? 'stop' : 'start',
        action: () => dispatch(actionCreators.sequencer.TOGGLE_IS_PLAYING()),
      },
    ],
    [isPlaying, actionCreators, dispatch]
  );
  const handleChange = useMemo(
    () =>
      mkHandleChange({
        dispatch,
        actionCreators,
      }),
    [dispatch, actionCreators]
  );

  return (
    <div className='sequencer-settings'>
      <ControlPanel state={state} settings={settings} onChange={handleChange} />
    </div>
  );
};

export default connect(mapStateToProps)(SequencerSettings);
