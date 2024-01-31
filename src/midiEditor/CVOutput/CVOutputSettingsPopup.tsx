import React, { useCallback, useMemo, useRef, useState } from 'react';
import ControlPanel from 'react-control-panel';

import type { CVOutputState } from 'src/midiEditor/CVOutput/CVOutput';
import './CVOutputSettingsPopup.css';
import { UnreachableError } from 'src/util';

interface CVOutputSettingsPopupProps {
  onSubmit: (newState: CVOutputState) => void;
  onCancel: () => void;
}

const buildSettings = (
  state: CVOutputState,
  handleSubmit: () => void,
  handleCancel: () => void
) => [
  { type: 'checkbox', label: 'log scale', initial: state.adsr.logScale },
  { type: 'text', label: 'min value', initial: `${state.minValue}` },
  { type: 'text', label: 'max value', initial: `${state.maxValue}` },
  { type: 'button', label: 'submit', action: handleSubmit },
  { type: 'button', label: 'cancel', action: handleCancel },
];

export const mkCVOutputSettingsPopup = (
  state: CVOutputState
): React.FC<CVOutputSettingsPopupProps> => {
  const CVOutputSettingsPopup: React.FC<CVOutputSettingsPopupProps> = ({ onSubmit, onCancel }) => {
    const panelCtx = useRef<Record<string, any> | null>(null);
    const [submitError, setSubmitError] = useState<string | null>(null);

    const handleSubmit = useCallback(() => {
      if (!panelCtx.current) {
        throw new UnreachableError(
          'Somehow submitted CVOutputSettingsPopup without a control panel context getting set'
        );
      }

      const minValue = parseFloat(panelCtx.current['min value']);
      if (isNaN(minValue)) {
        setSubmitError('Min value must be a number');
        return;
      }
      const maxValue = parseFloat(panelCtx.current['max value']);
      if (isNaN(maxValue)) {
        setSubmitError('Max value must be a number');
        return;
      }

      if (minValue >= maxValue) {
        setSubmitError('Min value must be less than max value');
        return;
      }

      const logScale = panelCtx.current['log scale'];
      if (logScale && (minValue <= 0 || maxValue <= 0)) {
        setSubmitError('Log scale requires min and max values to be greater than 0');
        return;
      }

      onSubmit({ ...state, minValue, maxValue, adsr: { ...state.adsr, logScale } });
    }, [onSubmit]);
    const settings = useMemo(
      () => buildSettings(state, handleSubmit, onCancel),
      [handleSubmit, onCancel]
    );

    return (
      <div className='cv-output-settings-popup'>
        <ControlPanel
          settings={settings}
          contextCb={(ctx: Record<string, any>) => {
            panelCtx.current = ctx;
          }}
        />
        {submitError && <div className='cv-output-settings-popup-error'>{submitError}</div>}
      </div>
    );
  };
  return CVOutputSettingsPopup;
};
