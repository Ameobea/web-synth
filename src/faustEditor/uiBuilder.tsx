import React from 'react';
import * as R from 'ramda';
import ControlPanel from 'react-control-panel';
import { filterNils, ValueOf, UnimplementedError, ArrayElementOf } from 'ameo-utils';
import { Option } from 'funfix-core';

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
  button = 'button',
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

const buildControlPanelField = (
  def: UiDef,
  setParamValue: FaustModuleInstance['setParamValue']
): ({ [key: string]: any } | null)[] => {
  const mapperFunctions: {
    [K in UiDef['type']]: (
      def: TypeForInputType<K>
    ) =>
      | ReturnType<typeof buildControlPanelField>
      | ArrayElementOf<ReturnType<typeof buildControlPanelField>>;
  } = {
    [InputType.hslider]: ({ address, min, max, init, step }: UiInput) => ({
      type: 'range',
      // Paths are prefixed with a long randomly generated string which we cut off to make it easier to read the labels
      label: R.tail(address.split('/').slice(1)).join(''),
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
      R.flatten(items.map(item => buildControlPanelField(item, setParamValue))),
    // TODO: Add label once `react-control-panel` supports that
    [GroupType.hgroup]: ({ items }: { label: string; items: UiDef[] }) =>
      R.flatten(items.map(item => buildControlPanelField(item, setParamValue))),
    [GroupType.button]: ({ address }) => ({
      type: 'button',
      label: address,
      onmousedown: () => setParamValue(address, 1),
      onmouseup: () => setParamValue(address, 0),
    }),
  };

  const mapper = mapperFunctions[def.type] as
    | ((def: UiDef) => ReturnType<ValueOf<typeof mapperFunctions>>)
    | undefined;
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

const mapUiGroupToControlPanelFields = (
  group: UiGroup,
  setParamValue: FaustModuleInstance['setParamValue']
): {}[] =>
  filterNils(R.flatten(group.items.map(item => buildControlPanelField(item, setParamValue))));

const buildControlPanel = (
  uiDef: UiGroup[],
  pathTable: { [path: string]: any },
  setParamValue: FaustModuleInstance['setParamValue']
) => {
  // Get the randomly generated path base so that we can accurately match when setting params
  const pathBase = Option.of(Object.keys(pathTable))
    .map(R.head)
    .map(path => path.split('/').slice(0, 2)[1])
    .getOrElse('');

  const controlPanelFieldDefinitions = R.flatten(
    uiDef.map(item => mapUiGroupToControlPanelFields(item, setParamValue))
  );

  if (R.isEmpty(controlPanelFieldDefinitions)) {
    return null;
  }

  return (
    <ControlPanel
      draggable
      theme='dark'
      position={{ top: 0, right: 20 }}
      settings={controlPanelFieldDefinitions}
      onChange={(path: string, val: number) => setParamValue(`/${pathBase}/${path}`, val)}
      width={500}
    />
  );
};

export default buildControlPanel;
