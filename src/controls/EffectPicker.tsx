import React from 'react';
import { connect } from 'react-redux';
import { useOnce } from 'ameo-utils/dist/util/react';

import { actionCreators, dispatch, ReduxStore } from 'src/redux';
import { Effect } from 'src/redux/modules/effects';
import { BACKEND_BASE_URL } from 'src/conf';

export const fetchEffects = (): Promise<Effect[]> =>
  fetch(`${BACKEND_BASE_URL}/effects`)
    .then(res => res.json())
    .catch(err => {
      console.warn('Error fetching effects from server; using local effects file.', err);
      return [];
    });

const mapStateToProps = ({ effects }: ReduxStore) => ({ effects: effects.sharedEffects });

/**
 * Creates an interface that can be used to select effects to use.
 */
const EffectPicker: React.FC<
  {
    onChange: (newId: number) => void;
    value: number;
  } & ReturnType<typeof mapStateToProps>
> = ({ value, onChange, effects }) => {
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

export default connect(mapStateToProps)(EffectPicker);
