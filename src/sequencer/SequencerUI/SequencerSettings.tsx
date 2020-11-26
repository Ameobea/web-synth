import React, { useMemo } from 'react';
import ControlPanel from 'react-control-panel';

import { SequencerReduxInfra } from 'src/sequencer/redux';

const mkHandleChange = ({
  dispatch,
  actionCreators,
}: {
  actionCreators: SequencerReduxInfra['actionCreators'];
  dispatch: SequencerReduxInfra['dispatch'];
}) => (key: string, val: any, _state: { [key: string]: any }) => {
  switch (key) {
    // case 'bpm': {
    //   dispatch(actionCreators.sequencer.SET_BPM(val));
    //   break;
    // }
    default: {
      console.error(`Unhandled key in SequencerSettings: "${key}"`);
    }
  }
};

const SequencerSettings: React.FC<SequencerReduxInfra> = ({
  actionCreators,
  dispatch,
  useSelector,
}) => {
  const isPlaying = useSelector(state => state.sequencer.isPlaying);

  const settings = useMemo(
    () => [
      // {
      //   type: 'range',
      //   label: 'bpm',
      //   min: 0,
      //   max: 4000,
      //   initial: 120,
      //   steps: 200,
      // },
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
      <ControlPanel state={{}} settings={settings} onChange={handleChange} />
    </div>
  );
};

export default SequencerSettings;
