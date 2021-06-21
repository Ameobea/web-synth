import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as R from 'ramda';
import ControlPanel from 'react-control-panel';

import ConfigureOperator, { OperatorConfig } from './ConfigureOperator';
import './FMSynth.scss';
import { classNameIncludes } from 'src/util';
import ConfigureEffects, { AdsrChangeHandler, Effect } from 'src/fmSynth/ConfigureEffects';
import FMSynth, { Adsr } from 'src/graphEditor/nodes/CustomAudio/FMSynth/FMSynth';
import ModulationMatrix from 'src/fmSynth/ModulationMatrix';
import ConfigureModulationIndex from 'src/fmSynth/ConfigureModulationIndex';
import ConfigureParamSource, {
  buildDefaultParamSource,
  ParamSource,
} from 'src/fmSynth/ConfigureParamSource';
import ConfigureOutputWeight from 'src/fmSynth/ConfigureOutputWeight';
import HelpIcon from 'src/misc/HelpIcon';
import { WaveformIcon } from 'src/misc/Icons';
import { buildWavyJonesInstance, WavyJones } from 'src/visualizations/WavyJones';
import TrainingMIDIControlIndexContext from 'src/fmSynth/TrainingMIDIControlIndexContext';
import { MIDINode } from 'src/patchNetwork/midiNode';
import MIDIControlValuesCache from 'src/graphEditor/nodes/CustomAudio/FMSynth/MIDIControlValuesCache';

interface FMSynthState {
  modulationMatrix: ParamSource[][];
  outputWeights: ParamSource[];
  operatorConfigs: OperatorConfig[];
  operatorEffects: (Effect | null)[][];
  mainEffectChain: (Effect | null)[];
  adsrs: Adsr[];
  detune: ParamSource | null;
}

type BackendModulationUpdater = (
  operatorIx: number,
  modulationIx: number,
  val: ParamSource
) => void;
type BackendOutputUpdater = (operatorIx: number, val: ParamSource) => void;

const ctx = new AudioContext();
const muted = ctx.createGain();
muted.gain.value = 0;
muted.connect(ctx.destination);

const setModulation = (
  state: FMSynthState,
  srcOperatorIx: number,
  dstOperatorIx: number,
  updateBackendModulation: BackendModulationUpdater,
  getNewVal: (prevVal: ParamSource) => ParamSource
): FMSynthState => {
  const newModulationIndices = [...state.modulationMatrix];
  newModulationIndices[srcOperatorIx] = [...newModulationIndices[srcOperatorIx]];
  newModulationIndices[srcOperatorIx][dstOperatorIx] = getNewVal(
    newModulationIndices[srcOperatorIx][dstOperatorIx]
  );
  updateBackendModulation(
    srcOperatorIx,
    dstOperatorIx,
    newModulationIndices[srcOperatorIx][dstOperatorIx]
  );
  return { ...state, modulationMatrix: newModulationIndices };
};

const setOutput = (
  state: FMSynthState,
  operatorIx: number,
  updateBackendOutput: BackendOutputUpdater,
  getNewVal: ParamSource | ((prevVal: number) => number)
): FMSynthState => {
  const newOutputWeights = [...state.outputWeights];
  newOutputWeights[operatorIx] =
    typeof getNewVal === 'function'
      ? ((): ParamSource => {
          const prevOperatorVal = state.outputWeights[operatorIx];
          const prevOutputWeight =
            prevOperatorVal.type === 'constant' ? prevOperatorVal.value : null;
          if (prevOutputWeight === null) {
            return prevOperatorVal;
          }

          return { type: 'constant', value: getNewVal(prevOutputWeight) };
        })()
      : getNewVal;
  updateBackendOutput(operatorIx, newOutputWeights[operatorIx]);
  return { ...state, outputWeights: newOutputWeights };
};

const ConfigureMainEffectChain: React.FC<{
  mainEffectChain: (Effect | null)[];
  onChange: (ix: number, newEffect: Effect | null) => void;
  setEffects: (newEffects: (Effect | null)[]) => void;
  adsrs: Adsr[];
  onAdsrChange: AdsrChangeHandler;
}> = ({ mainEffectChain, onChange, setEffects, adsrs, onAdsrChange }) => (
  <ConfigureEffects
    operatorIx={null}
    state={mainEffectChain}
    onChange={onChange}
    setOperatorEffects={setEffects}
    adsrs={adsrs}
    onAdsrChange={onAdsrChange}
  />
);

const initializeWavyJones = (getFMSynthOutput: () => Promise<AudioNode>) => {
  const inst = buildWavyJonesInstance(ctx, 'fm-synth-oscilloscope', 490, 240);
  getFMSynthOutput().then(fmSynthOutput => fmSynthOutput.connect(inst));
  inst.connect(muted);
  return inst;
};

export type UISelection =
  | { type: 'mainEffectChain' }
  | { type: 'operator'; index: number }
  | { type: 'modulationIndex'; srcOperatorIx: number; dstOperatorIx: number }
  | { type: 'outputWeight'; operatorIx: number }
  | { type: 'oscilloscope' };

interface FMSynthUIProps {
  updateBackendModulation: BackendModulationUpdater;
  updateBackendOutput: BackendOutputUpdater;
  modulationMatrix: ParamSource[][];
  outputWeights: ParamSource[];
  operatorConfigs: OperatorConfig[];
  onOperatorConfigChange: (operatorIx: number, newConfig: OperatorConfig) => void;
  operatorEffects: (Effect | null)[][];
  mainEffectChain: (Effect | null)[];
  setEffect: (operatorIx: number | null, effectIx: number, effect: Effect | null) => void;
  initialSelectedUI?: UISelection | null;
  onSelectedUIChange: (newSelectedUI: UISelection | null) => void;
  adsrs: Adsr[];
  onAdsrChange: AdsrChangeHandler;
  detune: ParamSource | null;
  handleDetuneChange: (newDetune: ParamSource | null) => void;
  getFMSynthOutput: () => Promise<AudioNode>;
  midiNode: MIDINode;
  midiControlValuesCache: MIDIControlValuesCache;
}

const FMSynthUI: React.FC<FMSynthUIProps> = ({
  updateBackendModulation,
  updateBackendOutput,
  modulationMatrix,
  outputWeights,
  operatorConfigs,
  onOperatorConfigChange,
  operatorEffects,
  mainEffectChain,
  setEffect,
  initialSelectedUI,
  onSelectedUIChange,
  adsrs,
  onAdsrChange,
  handleDetuneChange,
  detune,
  getFMSynthOutput,
  midiNode,
  midiControlValuesCache,
}) => {
  const [state, setState] = useState<FMSynthState>({
    modulationMatrix,
    outputWeights,
    operatorConfigs,
    operatorEffects,
    mainEffectChain,
    adsrs,
    detune,
  });
  const [selectedUI, setSelectedUIInner] = useState<UISelection | null>(initialSelectedUI ?? null);
  const setSelectedUI = useCallback(
    (newSelectedUI: UISelection | null) => {
      onSelectedUIChange(newSelectedUI);
      setSelectedUIInner(newSelectedUI);
    },
    [onSelectedUIChange]
  );
  const wavyJonesInstance = useRef<WavyJones | null>(null);

  const onOperatorChange = (selectedOperatorIx: number, newConf: OperatorConfig) => {
    setState({
      ...state,
      operatorConfigs: R.set(R.lensIndex(selectedOperatorIx), newConf, state.operatorConfigs),
    });
    onOperatorConfigChange(selectedOperatorIx, newConf);
  };

  const onModulationIndexChange = (
    srcOperatorIx: number,
    dstOperatorIx: number,
    newModulationIndex: ParamSource
  ) =>
    setState(
      setModulation(
        state,
        srcOperatorIx,
        dstOperatorIx,
        updateBackendModulation,
        (_prevVal: ParamSource) => newModulationIndex
      )
    );

  const onOutputWeightChange = (operatorIx: number, newOutputWeight: ParamSource) =>
    setState(setOutput(state, operatorIx, updateBackendOutput, newOutputWeight));

  useEffect(() => {
    if (selectedUI?.type === 'oscilloscope') {
      if (!wavyJonesInstance.current) {
        wavyJonesInstance.current = initializeWavyJones(getFMSynthOutput);
      }
      return;
    }

    // Free wavyjones instances when not displayed
    if (wavyJonesInstance.current) {
      try {
        const inst = wavyJonesInstance.current;
        inst.disconnect();
        getFMSynthOutput().then(fmSynthOutputNode => {
          try {
            fmSynthOutputNode.disconnect(inst);
          } catch (_err) {
            // pass
          }
        });
      } catch (_err) {
        // pass
      }
      cancelAnimationFrame(wavyJonesInstance.current.animationFrameHandle);
      wavyJonesInstance.current = null;
      const vizElem = document.querySelector('#fm-synth-oscilloscope');
      while (vizElem?.firstChild) {
        vizElem.removeChild(vizElem.firstChild);
      }
    }
  }, [getFMSynthOutput, selectedUI?.type]);

  useEffect(() => {
    const handler = (evt: WheelEvent) => {
      const path = evt.composedPath();
      const operatorElem = path.find(elem =>
        classNameIncludes((elem as any).className, 'operator-square')
      ) as HTMLDivElement | undefined;
      if (!operatorElem) {
        return;
      }

      if (classNameIncludes(operatorElem.className, 'output-weight')) {
        const operatorIx = +operatorElem.getAttribute('data-operator-ix')!;
        setState(
          setOutput(state, operatorIx, updateBackendOutput, (prevVal: number) =>
            R.clamp(0, 1, prevVal + (evt.deltaY > 0 ? -1 : 1) * 0.01)
          )
        );
      } else {
        const srcOperatorIx = +operatorElem.getAttribute('data-src-operator-ix')!;
        const dstOperatorIx = +operatorElem.getAttribute('data-dst-operator-ix')!;
        setState(
          setModulation(
            state,
            srcOperatorIx,
            dstOperatorIx,
            updateBackendModulation,
            (prevVal: ParamSource) => {
              if (prevVal.type !== 'constant') {
                return prevVal;
              }
              return { type: 'constant', value: prevVal.value + (evt.deltaY > 0 ? -1 : 1) * 0.1 };
            }
          )
        );
      }

      evt.preventDefault();
      evt.stopPropagation();
    };

    window.addEventListener('wheel', handler, { passive: false });
    return () => window.removeEventListener('wheel', handler);
  }, [state, updateBackendModulation, updateBackendOutput]);

  const handleMainEffectChainChange = (effectIx: number, newEffect: Effect | null) => {
    const newMainEffectChain = [...state.mainEffectChain];
    newMainEffectChain[effectIx] = newEffect;
    if (!newEffect) {
      // Slide remaining effects down.  Deleting will trigger this to happen on the
      // backend as well.
      for (let i = effectIx; i < newMainEffectChain.length; i++) {
        const nextEffect = newMainEffectChain[i + 1];
        if (nextEffect) {
          newMainEffectChain[i] = nextEffect;
          newMainEffectChain[i + 1] = null;
          setEffect(null, i + 1, null);
        }
      }
    }

    setEffect(null, effectIx, newEffect);
    setState({ ...state, mainEffectChain: newMainEffectChain });
  };

  const handleEffectChange = (effectIx: number, newEffect: Effect | null) => {
    if (selectedUI?.type !== 'operator') {
      console.warn('UI invariant in handleEffectChange');
      return;
    }
    const { index: selectedOperatorIx } = selectedUI;

    setEffect(selectedOperatorIx, effectIx, newEffect);
    const newState = { ...state };
    newState.operatorEffects = [...newState.operatorEffects];
    newState.operatorEffects[selectedOperatorIx] = [
      ...newState.operatorEffects[selectedOperatorIx],
    ];
    newState.operatorEffects[selectedOperatorIx][effectIx] = newEffect;

    if (!newEffect) {
      // Slide remaining effects down.  Deleting will trigger this to happen on the backend as well.
      for (let i = effectIx; i < newState.operatorEffects[selectedOperatorIx].length; i++) {
        const nextEffect = newState.operatorEffects[selectedOperatorIx][i + 1];
        if (nextEffect) {
          newState.operatorEffects[selectedOperatorIx][i] = nextEffect;
          newState.operatorEffects[selectedOperatorIx][i + 1] = null;
          setEffect(selectedOperatorIx, i + 1, null);
        }
      }
    }

    setState(newState);
  };

  const handleAdsrChange = (adsrIx: number, newAdsr: Adsr) => {
    onAdsrChange(adsrIx, newAdsr);
    if (!state.adsrs[adsrIx]) {
      setState({ ...state, adsrs: [...state.adsrs, newAdsr] });
    } else {
      setState({ ...state, adsrs: R.set(R.lensIndex(adsrIx), newAdsr, state.adsrs) });
    }
  };

  return (
    <TrainingMIDIControlIndexContext.Provider value={{ midiNode, midiControlValuesCache }}>
      <div className='fm-synth-ui'>
        <h2>
          Modulation Matrix <HelpIcon link='modulation-matrix' />
        </h2>
        <ModulationMatrix
          onOperatorSelected={useCallback(
            (newSelectedOperatorIx: number) =>
              setSelectedUI({ type: 'operator', index: newSelectedOperatorIx }),
            [setSelectedUI]
          )}
          onModulationIndexSelected={useCallback(
            (srcOperatorIx: number, dstOperatorIx: number) =>
              setSelectedUI({ type: 'modulationIndex', srcOperatorIx, dstOperatorIx }),
            [setSelectedUI]
          )}
          resetModulationIndex={useCallback(
            (srcOperatorIx: number, dstOperatorIx: number) =>
              setState(
                setModulation(state, srcOperatorIx, dstOperatorIx, updateBackendModulation, () => ({
                  type: 'constant',
                  value: 0,
                }))
              ),
            [state, updateBackendModulation]
          )}
          modulationIndices={state.modulationMatrix}
          operatorConfigs={state.operatorConfigs}
          outputWeights={state.outputWeights}
          selectedUI={selectedUI}
          onOutputWeightSelected={useCallback(
            (operatorIx: number) => setSelectedUI({ type: 'outputWeight', operatorIx }),
            [setSelectedUI]
          )}
        />

        <div className='bottom-button-wrapper'>
          <div
            role='button'
            className='main-effect-chain-selector'
            data-active={selectedUI?.type === 'mainEffectChain' ? 'true' : 'false'}
            onClick={() => setSelectedUI({ type: 'mainEffectChain' })}
          >
            MAIN EFFECT CHAIN
          </div>
          <div
            role='button'
            className='oscilloscope-button'
            onClick={() => {
              if (selectedUI?.type === 'oscilloscope') {
                return;
              }
              wavyJonesInstance.current = initializeWavyJones(getFMSynthOutput);
              setSelectedUI({ type: 'oscilloscope' });
            }}
            data-active={selectedUI?.type === 'oscilloscope' ? 'true' : 'false'}
            title='oscilloscope'
          >
            <WaveformIcon style={{ height: 28, width: 28, marginTop: -1 }} />
          </div>
        </div>

        {/* <HelpIcon
          link='detune'
          style={{ marginTop: 8, zIndex: 1 }}
          tooltipStyle={{ zIndex: 1, transform: 'translate(0px, 34px)' }}
          size={12}
          arrow={false}
          position='top-start'
        /> */}
        <ControlPanel
          state={{ 'enable detune': !!state.detune }}
          settings={[{ type: 'checkbox', label: 'enable detune' }]}
          onChange={(_key: string, val: boolean) => {
            if (val) {
              const newDetune = buildDefaultParamSource('constant', -300, 300, 0);
              handleDetuneChange(newDetune);
              setState({ ...state, detune: newDetune });
            } else {
              handleDetuneChange(null);
              setState({ ...state, detune: null });
            }
          }}
        />
        {state.detune ? (
          <ConfigureParamSource
            state={state.detune}
            onChange={newDetune => {
              handleDetuneChange(newDetune);
              setState({ ...state, detune: newDetune });
            }}
            adsrs={state.adsrs}
            onAdsrChange={handleAdsrChange}
            min={-600}
            max={600}
          />
        ) : null}
      </div>
      <div className='fm-synth-configuration'>
        {selectedUI?.type === 'mainEffectChain' ? (
          <ConfigureMainEffectChain
            mainEffectChain={state.mainEffectChain}
            onChange={handleMainEffectChainChange}
            setEffects={(newEffects: (Effect | null)[]) => {
              newEffects.forEach((effect, effectIx) => setEffect(null, effectIx, effect));
              setState({ ...state, mainEffectChain: newEffects });
            }}
            adsrs={state.adsrs}
            onAdsrChange={handleAdsrChange}
          />
        ) : null}
        {selectedUI?.type === 'operator'
          ? (() => {
              const selectedOperatorIx = selectedUI.index;

              return (
                <ConfigureOperator
                  operatorIx={selectedUI.index}
                  config={state.operatorConfigs[selectedOperatorIx]}
                  onChange={newConf => onOperatorChange(selectedOperatorIx, newConf)}
                  effects={state.operatorEffects[selectedOperatorIx]}
                  onEffectsChange={handleEffectChange}
                  setEffects={newEffects => {
                    newEffects.forEach((effect, effectIx) =>
                      setEffect(selectedOperatorIx, effectIx, effect)
                    );
                    setState({
                      ...state,
                      operatorEffects: R.set(
                        R.lensIndex(selectedOperatorIx),
                        newEffects,
                        state.operatorEffects
                      ),
                    });
                  }}
                  adsrs={state.adsrs}
                  onAdsrChange={handleAdsrChange}
                />
              );
            })()
          : null}
        {selectedUI?.type === 'modulationIndex' ? (
          <ConfigureModulationIndex
            srcOperatorIx={selectedUI.srcOperatorIx}
            dstOperatorIx={selectedUI.dstOperatorIx}
            modulationIndices={state.modulationMatrix}
            onChange={onModulationIndexChange}
            adsrs={state.adsrs}
            onAdsrChange={handleAdsrChange}
          />
        ) : null}
        {selectedUI?.type === 'outputWeight' ? (
          <ConfigureOutputWeight
            operatorIx={selectedUI.operatorIx}
            adsrs={adsrs}
            onAdsrChange={handleAdsrChange}
            state={state.outputWeights[selectedUI.operatorIx]}
            onChange={newOutputWeight =>
              onOutputWeightChange(selectedUI.operatorIx, newOutputWeight)
            }
          />
        ) : null}
        <div
          id='fm-synth-oscilloscope'
          style={{ display: selectedUI?.type === 'oscilloscope' ? 'block' : 'none' }}
        />
      </div>
    </TrainingMIDIControlIndexContext.Provider>
  );
};

export const ConnectedFMSynthUI: React.FC<{
  synth: FMSynth;
  getFMSynthOutput: () => Promise<AudioNode>;
  midiNode: MIDINode;
}> = ({ synth, getFMSynthOutput, midiNode }) => (
  <FMSynthUI
    updateBackendModulation={useCallback(
      (srcOperatorIx: number, dstOperatorIx: number, val: ParamSource) =>
        synth.handleModulationIndexChange(srcOperatorIx, dstOperatorIx, val),
      [synth]
    )}
    updateBackendOutput={useCallback(
      (operatorIx: number, val: ParamSource) => synth.handleOutputWeightChange(operatorIx, val),
      [synth]
    )}
    modulationMatrix={synth.getModulationMatrix()}
    outputWeights={synth.getOutputWeights()}
    operatorConfigs={synth.getOperatorConfigs()}
    onOperatorConfigChange={useCallback(
      (operatorIx: number, newOperatorConfig: OperatorConfig) =>
        synth.handleOperatorConfigChange(operatorIx, newOperatorConfig),
      [synth]
    )}
    operatorEffects={synth.getOperatorEffects()}
    mainEffectChain={synth.getMainEffectChain()}
    setEffect={synth.setEffect.bind(synth)}
    initialSelectedUI={synth.selectedUI}
    onSelectedUIChange={useCallback(
      newSelectedUI => {
        synth.selectedUI = newSelectedUI;
      },
      [synth]
    )}
    adsrs={synth.getAdsrs()}
    onAdsrChange={useCallback(
      (adsrIx: number, newAdsr: Adsr) => synth.handleAdsrChange(adsrIx, newAdsr),
      [synth]
    )}
    detune={synth.getDetune()}
    handleDetuneChange={useCallback(
      (newDetune: ParamSource) => synth.handleDetuneChange(newDetune),
      [synth]
    )}
    getFMSynthOutput={getFMSynthOutput}
    midiNode={midiNode}
    midiControlValuesCache={synth.midiControlValuesCache}
  />
);

export default FMSynthUI;
