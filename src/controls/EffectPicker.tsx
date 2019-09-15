import React from 'react';
import { connect } from 'react-redux';

import { actionCreators, dispatch, ReduxStore } from '../redux';
import { Effect } from '../redux/modules/effects';
import { useOnce } from '../hooks';
import { BACKEND_BASE_URL } from '../conf';

interface StateProps {
  effects: Effect[];
}

interface PassedProps {
  onChange: (newId: number) => void;
  value: number;
}

type EffectPickerProps = StateProps & PassedProps;

export const fetchEffects = async (): Promise<Effect[]> => {
  try {
    const effects = await fetch(`${BACKEND_BASE_URL}/effects`);
    return effects.json();
  } catch (err) {
    console.warn('Error fetching effects from server; using local effects file.');
    return [];
  }
};

/**
 * Creates an interface that can be used to select effects to use.
 */
const EffectPicker: React.FunctionComponent<PassedProps> = ({
  value,
  onChange,
  effects,
}: EffectPickerProps) => {
  useOnce(async () => {
    const effects = await fetchEffects();
    dispatch(actionCreators.effects.ADD_EFFECTS(effects));
    onChange(effects[0].id);
  });

  return (
    <select value={value} onChange={evt => onChange(parseInt(evt.target.value, 10))}>
      {effects.map(effect => (
        <option key={effect.id} value={effect.id}>
          {effect.title}
        </option>
      ))}
    </select>
  );
};

const mapStateToProps: (reduxState: ReduxStore) => StateProps = ({ effects }) => ({
  effects: effects.sharedEffects,
});

const enhance = connect(mapStateToProps);

const EnhancedEffectPicker = enhance(EffectPicker);

export default EnhancedEffectPicker;
