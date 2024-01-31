import { Option } from 'funfix-core';
import * as R from 'ramda';
import React, { useCallback, useMemo, useRef } from 'react';
import ControlPanel from 'react-control-panel';

import type { DynamicCodeWorkletNode } from 'src/faustEditor/DymanicCodeWorkletNode';
import { UnimplementedError, type ArrayElementOf, type ValueOf, filterNils } from 'src/util';

interface BaseUiDef {
  label: string;
  address: string;
}

enum InputType {
  hslider = 'hslider',
  vslider = 'vslider',
  range = 'range',
  button = 'button',
  nentry = 'nentry',
  checkbox = 'checkbox',
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

const getLabel = (address: string) => R.tail(address.split('/').slice(1)).join('/');

const buildControlPanelField = (
  def: UiDef,
  setParamValue: (path: string, val: number) => void,
  paramDefaults: { [path: string]: number }
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
      label: getLabel(address),
      min,
      max,
      defaultVal: init,
      initial: paramDefaults[address] ?? init,
      step,
      address,
    }),
    [InputType.vslider]: ({ address, min, max, init, step }: UiInput) => ({
      type: 'range',
      // Paths are prefixed with a long randomly generated string which we cut off to make it easier to read the labels
      label: getLabel(address),
      min,
      max,
      defaultVal: init,
      initial: paramDefaults[address] ?? init,
      step,
      address,
    }),
    [InputType.range]: () => {
      throw new UnimplementedError();
    },
    [InputType.button]: ({ address }) => ({
      type: 'button',
      label: getLabel(address),
      onmousedown: () => setParamValue(address, 1),
      onmouseup: () => setParamValue(address, 0),
      address,
      initial: 0,
    }),
    // TODO: Use real number-entry input once that's implement on the react-control-panel side
    [InputType.nentry]: ({ address, min, max, init, step }: UiInput) => ({
      type: 'range',
      // Paths are prefixed with a long randomly generated string which we cut off to make it easier to read the labels
      label: getLabel(address),
      min,
      max,
      defaultVal: init,
      initial: paramDefaults[address] ?? init,
      step,
      address,
    }),
    [InputType.checkbox]: ({ address }) => ({
      type: 'checkbox',
      label: getLabel(address),
      initial: false,
      address,
    }),
    // TODO: Add label once `react-control-panel` supports that
    [GroupType.vgroup]: ({ items }: { label: string; items: UiDef[] }) =>
      R.flatten(items.map(item => buildControlPanelField(item, setParamValue, paramDefaults))),
    // TODO: Add label once `react-control-panel` supports that
    [GroupType.hgroup]: ({ items }: { label: string; items: UiDef[] }) =>
      R.flatten(items.map(item => buildControlPanelField(item, setParamValue, paramDefaults))),
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

export const mapUiGroupToControlPanelFields = (
  group: UiGroup,
  setParamValue: (path: string, val: number) => void,
  paramDefaults: { [path: string]: number }
) =>
  filterNils(
    R.flatten(group.items.map(item => buildControlPanelField(item, setParamValue, paramDefaults)))
  );

const getFaustParamBasePath = (fullPath: string): string => fullPath.split('/').slice(0, 2)[1];

const buildControlPanelComponent = (
  instance: DynamicCodeWorkletNode,
  setParamValue: (path: string, val: number) => void,
  paramDefaults: { [path: string]: number }
) => {
  // Get the randomly generated path base so that we can accurately match when setting params
  const pathBase = (instance as any).pathTable
    ? Option.of(R.head(Object.keys((instance as any).pathTable)))
        .map(getFaustParamBasePath)
        .getOrElse('')
    : null;

  const settings = instance.getParamSettings(paramDefaults, setParamValue);

  if (R.isEmpty(settings)) {
    return () => null;
  }

  const handleChange = (path: string, val: number) =>
    setParamValue(pathBase === null ? path : `/${pathBase}/${path}`, val);

  const FaustEditorControlPanel: React.FC<{
    style?: React.CSSProperties;
    position?: any;
    draggable?: boolean;
  }> = ({ position, style, draggable = true }) => {
    const panelCtx = useRef<any>(null);
    const combinedSettings = useMemo(
      () => [
        ...settings,
        {
          type: 'button',
          label: 'reset',
          action: () => {
            if (!panelCtx.current) {
              return;
            }
            const ctx = panelCtx.current;

            settings.forEach(setting => {
              if (
                !setting.address ||
                R.isNil(setting.defaultVal) ||
                ctx[setting.label] === setting.defaultVal
              ) {
                return;
              }

              ctx[setting.label] = setting.defaultVal;
              setParamValue(
                pathBase === null ? setting.label : `/${pathBase}/${setting.label}`,
                setting.defaultVal ?? setting.init
              );
            });
          },
        },
        {
          type: 'button',
          label: 'randomize',
          action: () => {
            if (!panelCtx.current) {
              return;
            }
            const ctx = panelCtx.current;

            settings.forEach(setting => {
              if (!setting.address || R.isNil(setting.min) || R.isNil(setting.max)) {
                return;
              }

              const scale = setting.max - setting.min;
              const shift = setting.min;
              const newVal = Math.random() * scale + shift;
              ctx[setting.label] = newVal;
              setParamValue(
                pathBase === null ? setting.label : `/${pathBase}/${setting.label}`,
                newVal
              );
            });
          },
        },
      ],
      []
    );
    const contextCb = useCallback((ctx: any) => {
      panelCtx.current = ctx;
    }, []);

    return (
      <ControlPanel
        draggable={draggable}
        theme='dark'
        position={position === null ? undefined : { top: 0, right: 44 }}
        style={style}
        settings={combinedSettings}
        onChange={handleChange}
        width={500}
        contextCb={contextCb}
      />
    );
  };
  return FaustEditorControlPanel;
};

export default buildControlPanelComponent;
