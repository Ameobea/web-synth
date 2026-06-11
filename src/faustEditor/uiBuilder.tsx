import { Option } from 'funfix-core';
import * as R from 'ramda';
import React, { Suspense, useCallback, useMemo, useRef } from 'react';

import type { DynamicCodeWorkletNode } from 'src/faustEditor/DymanicCodeWorkletNode';

export {
  mapUiGroupToControlPanelFields,
  type UiGroup,
} from 'src/faustEditor/faustUiFields';

const LazyControlPanel = React.lazy(() => import('react-control-panel'));
const ControlPanel: React.FC<any> = props => (
  <Suspense fallback={null}>
    <LazyControlPanel {...props} />
  </Suspense>
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
