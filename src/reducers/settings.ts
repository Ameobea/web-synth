import * as R from 'ramda';

import { SET_SETTING } from '../actions/settings';

export default (state = {}, action) => {
  const fn = {
    [SET_SETTING]: state => R.set(R.lensProp(action.name), action.val, state),
  }[action.type];

  return fn ? fn(state) : state;
};
