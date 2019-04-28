import React from 'react';
import * as R from 'ramda';
import ControlPanel from 'react-control-panel';

import { FaustModuleInstance } from './FaustEditor';

interface BaseUiDef {
  type: string;
  label: string;
  address: string;
}

interface UiDefExtra {
  min: number;
  max: number;
  step: number;
  init: number;
}

type UiDef = BaseUiDef & UiDefExtra;

export interface UiGroup {
  items: UiDef[];
  label: string;
  type: string;
}

const buildControlPanelField = (def: UiDef): {} | null => {
  const mapper = {
    hslider: ({ address, min, max, init, step }: UiDef) => ({
      type: 'range',
      label: address,
      min,
      max,
      initial: init,
      step,
    }),
  }[def.type];

  if (!mapper) {
    console.warn(`Unable to build UI field of type ${def.type}`);
    return null;
  }

  return mapper(def);
};

const mapUiGroupToControlPanelFields = (group: UiGroup): {}[] =>
  group.items.map(buildControlPanelField).filter((group): group is {} => !!group);

const buildControlPanel = (
  uiDef: UiGroup[],
  setParamValue: FaustModuleInstance['setParamValue']
) => {
  const controlPanelFieldDefinitions = uiDef.flatMap(mapUiGroupToControlPanelFields);

  if (R.isEmpty(controlPanelFieldDefinitions)) {
    return null;
  }

  return (
    <ControlPanel
      draggable
      theme='dark'
      position={{ top: -100, right: 0 }}
      settings={controlPanelFieldDefinitions}
      onChange={setParamValue}
    />
  );
};

export default buildControlPanel;
