import React, { useCallback, useMemo } from 'react';
import ControlPanel from 'react-control-panel';
import { shallowEqual, useSelector } from 'react-redux';

import { looperDispatch, type ReduxStore } from 'src/redux';
import {
  looperActions,
  type LooperTransitionAlgorithmState,
  type LooperTransitionAlgorithmUIState,
} from 'src/redux/modules/looper';

type ConfigureTransitionAlgorithmTypeProps<
  T extends keyof Omit<LooperTransitionAlgorithmUIState, 'type'>
> = LooperTransitionAlgorithmUIState[T] & {
  vcId: string;
};

const ConfigureConstant: React.FC<ConfigureTransitionAlgorithmTypeProps<'constant'>> = () => (
  <div style={{ textAlign: 'center' }}>
    In this mode, the active bank will not transition automatically. Click the bank you want to
    activate in the list above.
  </div>
);

const ConfigureStaticPattern: React.FC<ConfigureTransitionAlgorithmTypeProps<'staticPattern'>> = ({
  vcId,
  pattern,
}) => (
  <>
    <textarea
      style={{ height: 50 }}
      value={pattern}
      onChange={evt =>
        looperDispatch(
          looperActions.setTransitionAlgorithmUIState({
            vcId,
            newUIState: { staticPattern: { pattern: evt.target.value } },
          })
        )
      }
    />
    <p style={{ marginTop: 4 }}>
      Enter in a pattern of bank indices to play. Note that bank indices start at 0.
    </p>
  </>
);

interface ConfigureTransitionAlgorithmProps {
  vcId: string;
}

const ConfigureTransitionAlgorithm: React.FC<ConfigureTransitionAlgorithmProps> = ({ vcId }) => {
  const { state, isExpanded } = useSelector((state: ReduxStore) => {
    const instState = state.looper.stateByVcId[vcId];
    return {
      state: instState.modules[instState.activeModuleIx]?.transitionAlgorithm as
        | LooperTransitionAlgorithmState
        | undefined,
      isExpanded: instState.configureTransitionAlgorithmExpanded,
    };
  }, shallowEqual);
  const ConfiguratorComp = useMemo(
    () =>
      state?.uiState.type
        ? (
            { constant: ConfigureConstant, staticPattern: ConfigureStaticPattern } as {
              [K in keyof Omit<LooperTransitionAlgorithmUIState, 'type'>]: React.FC<
                LooperTransitionAlgorithmUIState[K]
              >;
            }
          )[state.uiState.type]
        : null,
    [state?.uiState.type]
  )!;
  const settings = useMemo(
    () => [
      {
        type: 'select',
        label: 'algorithm',
        options: { constant: 'constant', 'static pattern': 'staticPattern' },
      },
      {
        type: 'button',
        label: 'commit',
        action: () => looperDispatch(looperActions.commitTransitionAlgorithm({ vcId })),
      },
    ],
    [vcId]
  );
  const onControlPanelChange = useCallback(
    (key: string, value: any) => {
      switch (key) {
        case 'algorithm':
          looperDispatch(
            looperActions.setTransitionAlgorithmUIState({ vcId, newUIState: { type: value } })
          );
          break;
        default:
          console.error('Unhandled key in `ConfigureTransitionAlgorithm`:', key);
      }
    },
    [vcId]
  );
  const controlPanelState = useMemo(
    () => ({ algorithm: state?.uiState.type }),
    [state?.uiState.type]
  );

  if (!isExpanded) {
    return (
      <div
        className='configure-transition-algorithm-collapsed'
        onClick={() =>
          looperDispatch(looperActions.setShowConfigureTransitionAlgorithm({ vcId, show: true }))
        }
      >
        › Transition Algorithm
      </div>
    );
  } else if (!state) {
    return <div className='configure-transition-algorithm' />;
  }

  return (
    <div className='configure-transition-algorithm'>
      <div
        className='header'
        onClick={() =>
          looperDispatch(looperActions.setShowConfigureTransitionAlgorithm({ vcId, show: false }))
        }
      >
        ⌄ Transition Algorithm
      </div>
      <div className='configure-transition-algorithm-content-wrapper'>
        <div className='left-pane'>
          <ControlPanel
            settings={settings}
            onChange={onControlPanelChange}
            state={controlPanelState}
          />
          {state.uiState.error ? (
            <span className='error-message'>{state.uiState.error}</span>
          ) : null}
        </div>
        <div className='configure-transition-algorithm-content'>
          <ConfiguratorComp vcId={vcId} {...(state.uiState[state.uiState.type] as any)} />
        </div>
      </div>
    </div>
  );
};

export default ConfigureTransitionAlgorithm;
