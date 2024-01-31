import React, { useMemo } from 'react';
import ControlPanel from 'react-control-panel';
import { shallowEqual } from 'react-redux';

import type { SequencerMark, SequencerReduxInfra, VoiceTarget } from 'src/sequencer/redux';
import { UnreachableError } from 'src/util';

const buildConfigureMarksSettings = (markState: SequencerMark | null | undefined) => {
  if (!markState) {
    return [];
  }

  switch (markState.type) {
    case 'gate': {
      return [
        { type: 'text', label: 'output value' },
        { type: 'checkbox', label: 'ungate' },
      ];
    }
    case 'midi': {
      return [];
    }
    case 'sample': {
      return [{ type: 'range', label: 'gain', min: 0, max: 5 }];
    }
    default: {
      throw new UnreachableError('Unhandled mark type: ' + (markState as any).type);
    }
  }
};

const buildConfigureMarksControlPanelState = (
  voice: VoiceTarget | null | undefined,
  markState: SequencerMark | null | undefined
) => {
  if (!markState || !voice) {
    return {};
  }

  switch (markState.type) {
    case 'gate': {
      if (voice.type !== 'gate') {
        throw new UnreachableError();
      }
      return markState.params
        ? { 'output value': markState.params.outputValue, ungate: markState.params.ungate ?? true }
        : { 'output value': `${voice.outputValue}`, ungate: voice.ungate ?? true };
    }
    case 'midi': {
      if (voice.type !== 'midi') {
        throw new UnreachableError();
      }
      return {};
    }
    case 'sample': {
      if (voice.type !== 'sample') {
        throw new UnreachableError();
      }
      return markState.params ?? { gain: voice.gain };
    }
    default: {
      throw new UnreachableError('Unhandled mark type: ' + (markState as any).type);
    }
  }
};

const buildConfigureMarksControlPanelChangeHandler =
  (
    voice: VoiceTarget | null | undefined,
    dispatch: ConfigureMarkProps['dispatch'],
    actionCreators: ConfigureMarkProps['actionCreators']
  ) =>
  (_key: string, _value: any, state: any) => {
    if (!voice) {
      return;
    }

    switch (voice.type) {
      case 'gate': {
        if (Number.isNaN(+state['output value'])) {
          break;
        }
        dispatch(
          actionCreators.sequencer.SET_MARK_STATE({
            type: voice.type,
            params: { outputValue: state['output value'], ungate: state.ungate },
          })
        );
        break;
      }
      case 'sample': {
        dispatch(actionCreators.sequencer.SET_MARK_STATE({ type: voice.type, params: state }));
        break;
      }
      case 'midi': {
        console.warn('Somehow edited MIDI mark??');
        break;
      }
      default: {
        throw new UnreachableError('Unhandled voice type: ' + (voice as any).type);
      }
    }
  };

type ConfigureMarkProps = SequencerReduxInfra;

const ConfigureMark: React.FC<ConfigureMarkProps> = ({ dispatch, useSelector, actionCreators }) => {
  const selectorOutput = useSelector(({ sequencer: state }) => {
    const markEditState = state.markEditState;
    if (!markEditState || markEditState.editingMarkIx === null) {
      return null;
    }

    return {
      voice: state.voices[markEditState.voiceIx],
      markState: state.marks[markEditState.voiceIx].marks[markEditState.editingMarkIx],
    };
  }, shallowEqual);

  const settings = useMemo(
    () => buildConfigureMarksSettings(selectorOutput?.markState),
    [selectorOutput?.markState]
  );
  const controlPanelState = useMemo(
    () => buildConfigureMarksControlPanelState(selectorOutput?.voice, selectorOutput?.markState),
    [selectorOutput?.markState, selectorOutput?.voice]
  );
  const handleChange = useMemo(
    () =>
      buildConfigureMarksControlPanelChangeHandler(selectorOutput?.voice, dispatch, actionCreators),
    [actionCreators, dispatch, selectorOutput?.voice]
  );

  if (!selectorOutput || !selectorOutput.markState) {
    return <div className='configure-mark'>No selected mark found</div>;
  }

  return (
    <div className='configure-mark'>
      <ControlPanel
        settings={settings}
        state={controlPanelState}
        onChange={handleChange}
        width={500}
      />
    </div>
  );
};

export default ConfigureMark;
