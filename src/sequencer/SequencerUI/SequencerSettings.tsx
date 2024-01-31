import React, { useMemo } from 'react';
import ControlPanel from 'react-control-panel';
import { shallowEqual } from 'react-redux';

import type { SequencerReduxInfra } from 'src/sequencer/redux';
import { filterNils } from 'src/util';

const mkHandleChange =
  ({
    dispatch,
    actionCreators,
  }: {
    actionCreators: SequencerReduxInfra['actionCreators'];
    dispatch: SequencerReduxInfra['dispatch'];
  }) =>
  (key: string, val: any, _state: { [key: string]: any }) => {
    switch (key) {
      case 'beat count': {
        dispatch(actionCreators.sequencer.SET_BEAT_COUNT(val));
        break;
      }
      default: {
        console.error(`Unhandled key in SequencerSettings: "${key}"`);
      }
    }
  };

const getSequencerSettings = ({
  actionCreators,
  dispatch,
  voiceCount,
  isPlaying,
  currentEditingVoiceIx,
  markCount,
  vcId,
}: SequencerReduxInfra & {
  isPlaying: boolean;
  voiceCount: number;
  currentEditingVoiceIx: number;
  markCount: number;
}) =>
  filterNils([
    {
      type: 'button',
      label: isPlaying ? 'stop' : 'start',
      action: () => dispatch(actionCreators.sequencer.TOGGLE_IS_PLAYING(vcId)),
    },
    {
      type: 'button',
      label: 'add voice',
      action: () => dispatch(actionCreators.sequencer.ADD_VOICE()),
    },
    voiceCount > 1
      ? {
          type: 'button',
          label: 'delete selected voice',
          action: () => dispatch(actionCreators.sequencer.REMOVE_VOICE(currentEditingVoiceIx)),
        }
      : null,
    {
      type: 'select',
      label: 'beat count',
      options: new Array(64).fill(0).map((_i, i) => i + 1),
      initial: markCount,
    },
  ]);

const SequencerSettings: React.FC<SequencerReduxInfra> = reduxInfra => {
  const { isPlaying, voiceCount, currentEditingVoiceIx, markCount } = reduxInfra.useSelector(
    state => ({
      isPlaying: state.sequencer.isPlaying,
      voiceCount: state.sequencer.voices.length,
      currentEditingVoiceIx: state.sequencer.currentEditingVoiceIx,
      markCount: state.sequencer.marks[0].marks.length,
    }),
    shallowEqual
  );

  const handleChange = useMemo(() => mkHandleChange(reduxInfra), [reduxInfra]);

  const settings = useMemo(
    () =>
      getSequencerSettings({
        ...reduxInfra,
        isPlaying,
        voiceCount,
        currentEditingVoiceIx,
        markCount,
      }),
    [reduxInfra, isPlaying, voiceCount, currentEditingVoiceIx, markCount]
  );

  return <ControlPanel style={{ width: 500 }} settings={settings} onChange={handleChange} />;
};

export default SequencerSettings;
