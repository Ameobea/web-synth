import React, { useMemo } from 'react';
import ControlPanel from 'react-control-panel';

import { dispatch, actionCreators } from 'src/redux';

const EffectModuleComp: React.FC<{
  synthIx: number;
  effectIx: number;
  params: { [key: string]: any };
  wetness: number;
  isBypassed: boolean;
  effectSettings: { [key: string]: any }[];
  effectName: string;
}> = ({ params, synthIx, effectIx, wetness, isBypassed, effectSettings, effectName }) => {
  const mergedState = useMemo(() => ({ ...params, wetness, bypass: isBypassed }), [
    params,
    wetness,
    isBypassed,
  ]);

  const combinedSettings = useMemo(
    () => [
      { type: 'checkbox', label: 'bypass', initial: true },
      { type: 'range', label: 'wetness', min: 0, max: 1, initial: 1, step: 0.01 },
      ...effectSettings,
    ],
    [effectSettings]
  );

  return (
    <div className='effect-module'>
      <div className='effect-module-connector-line-wrapper'>
        <div className='effect-module-connector-line' />
      </div>
      <div
        className='remove-button'
        onClick={() => dispatch(actionCreators.synthDesigner.REMOVE_EFFECT(synthIx, effectIx))}
        style={{
          marginRight: -13,
          marginLeft: 3,
          zIndex: 3,
        }}
      >
        X
      </div>
      <ControlPanel
        title={effectName.toUpperCase()}
        settings={combinedSettings}
        state={mergedState}
        onChange={(key: string, val: any) => {
          switch (key) {
            case 'wetness': {
              dispatch(actionCreators.synthDesigner.SET_EFFECT_WETNESS(synthIx, effectIx, val));
              break;
            }
            case 'bypass': {
              dispatch(actionCreators.synthDesigner.SET_EFFECT_BYPASSED(synthIx, effectIx, val));
              break;
            }
            default: {
              dispatch(actionCreators.synthDesigner.SET_EFFECT_PARAM(synthIx, effectIx, key, val));
            }
          }
        }}
      />
    </div>
  );
};

export default EffectModuleComp;
