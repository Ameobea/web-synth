import React, { useMemo } from 'react';
import ControlPanel from 'react-control-panel';
import { connect } from 'react-redux';

import type { FaustEditorPolyphonyState, FaustEditorState } from 'src/redux/modules/faustEditor';

const mapStateToProps = (state: { faustEditor: FaustEditorState }) => ({
  cachedInputNames: state.faustEditor.cachedInputNames,
});

const PolyphonyControlsInnerInner: React.FC<
  {
    state: FaustEditorPolyphonyState;
    setState: (newState: FaustEditorPolyphonyState) => void;
  } & ReturnType<typeof mapStateToProps>
> = ({ state, setState, cachedInputNames }) => {
  const cpState = useMemo(
    () => ({
      voices: state.voiceCount,
      'frequency input name': state.frequencyInputName,
      'gate input name': state.gateInputName,
    }),
    [state.voiceCount, state.frequencyInputName, state.gateInputName]
  );

  const settings = useMemo(
    () => [
      {
        label: 'voices',
        type: 'range',
        min: 2,
        max: 32,
        step: 1,
      },
      {
        label: 'frequency input name',
        type: 'select',
        options: [null, ...(cachedInputNames ? cachedInputNames : [])],
      },
      {
        label: 'gate input name',
        type: 'select',
        options: [null, ...(cachedInputNames ? cachedInputNames : [])],
      },
    ],
    [cachedInputNames]
  );

  return (
    <div>
      <ControlPanel
        style={{ width: 450 }}
        state={cpState}
        onChange={(key: string, val: any) => {
          switch (key) {
            case 'voices': {
              setState({ ...state, voiceCount: val });
              break;
            }
            case 'frequency input name': {
              setState({ ...state, frequencyInputName: val });
              break;
            }
            case 'gate input name': {
              setState({ ...state, gateInputName: val });
              break;
            }
            default: {
              throw new Error(`Unhandled state key "${key}" in Faust editor polyphony controls`);
            }
          }
        }}
        settings={settings}
      />
    </div>
  );
};

const PolyphonyControlsInner = connect(mapStateToProps)(PolyphonyControlsInnerInner);

const FaustEditorPolyphonyControls: React.FC<{
  state: FaustEditorPolyphonyState;
  setState: (newState: FaustEditorPolyphonyState) => void;
}> = ({ state, setState }) => {
  return (
    <div>
      <h2>Polyphony Controls</h2>
      Enable Polyphony
      <input
        type='checkbox'
        checked={state.polyphonyEnabled}
        onChange={evt => setState({ ...state, polyphonyEnabled: evt.target.checked })}
      />
      {state.polyphonyEnabled ? <PolyphonyControlsInner state={state} setState={setState} /> : null}
    </div>
  );
};

export default FaustEditorPolyphonyControls;
