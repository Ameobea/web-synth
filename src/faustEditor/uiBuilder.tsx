import React from 'react';
import * as R from 'ramda';
import ControlPanel from 'react-control-panel';
import { filterNils, ValueOf, UnimplementedError, ArrayElementOf } from 'ameo-utils';

import { FaustModuleInstance } from './FaustEditor';

interface BaseUiDef {
  label: string;
  address: string;
}

enum InputType {
  hslider = 'hslider',
  range = 'range',
}

enum GroupType {
  vgroup = 'vgroup',
  hgroup = 'hgroup',
}

interface UiInput extends BaseUiDef {
  type: InputType;
  min: number;
  max: number;
  step: number;
  init: number;
}

export interface UiGroup extends BaseUiDef {
  type: GroupType;
  items: UiDef[];
  label: string;
}

type UiDef = UiInput | UiGroup;

type TypeForInputType<K extends UiDef['type']> = Extract<
  UiDef,
  { type: K extends InputType ? InputType : K extends GroupType ? GroupType : never }
>;

const buildControlPanelField = (def: UiDef): ({ [key: string]: any } | null)[] => {
  const mapperFunctions: {
    [K in UiDef['type']]: (
      def: TypeForInputType<K>
    ) =>
      | ReturnType<typeof buildControlPanelField>
      | ArrayElementOf<ReturnType<typeof buildControlPanelField>>;
  } = {
    [InputType.hslider]: ({ address, min, max, init, step }: UiInput) => ({
      type: 'range',
      label: address,
      min,
      max,
      initial: init,
      step,
    }),
    [InputType.range]: () => {
      throw new UnimplementedError();
    },
    // TODO: Add label once `react-control-panel` supports that
    [GroupType.vgroup]: ({ items }: { label: string; items: UiDef[] }) =>
      R.flatten(items.map(buildControlPanelField)),
    // TODO: Add label once `react-control-panel` supports that
    [GroupType.hgroup]: ({ items }: { label: string; items: UiDef[] }) =>
      R.flatten(items.map(buildControlPanelField)),
  };

  const mapper = mapperFunctions[def.type] as (
    def: UiDef
  ) => ReturnType<ValueOf<typeof mapperFunctions>>;
  if (!mapper) {
    console.warn(`Unable to build UI field of type ${def.type}`);
    return [null];
  }

  const mappedDefs = mapper(def);
  if (R.isNil(mappedDefs)) {
    return [mappedDefs];
  }

  return Array.isArray(mappedDefs)
    ? (mappedDefs as ({ [key: string]: any } | null)[])
    : [mappedDefs as { [key: string]: any }];
};

const mapUiGroupToControlPanelFields = (group: UiGroup): {}[] =>
  filterNils(R.flatten(group.items.map(buildControlPanelField)));

const buildControlPanel = (
  uiDef: UiGroup[],
  setParamValue: FaustModuleInstance['setParamValue']
) => {
  const controlPanelFieldDefinitions = R.flatten(uiDef.map(mapUiGroupToControlPanelFields));

  if (R.isEmpty(controlPanelFieldDefinitions)) {
    return null;
  }

  return (
    <ControlPanel
      draggable
      theme='dark'
      position={{ top: 0, right: 20 }}
      settings={controlPanelFieldDefinitions}
      onChange={setParamValue}
      width={500}
    />
  );
};

export default buildControlPanel;
