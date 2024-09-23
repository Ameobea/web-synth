import { useDispatch } from 'react-redux';

import { actionCreators } from 'src/redux';
import { fetchSynthVoicePresets } from 'src/redux/modules/presets';

export const VoicePresetFetchError: React.FC = () => {
  const dispatch = useDispatch();

  return (
    <div className='preset-fetch-error'>
      Error fetching synth voice presets
      <button
        onClick={() => {
          dispatch(actionCreators.presets.SET_SYNTH_VOICE_PRESETS('FETCHING'));
          fetchSynthVoicePresets();
        }}
      >
        Retry
      </button>
    </div>
  );
};
