import React, { useMemo, useState } from 'react';
import { connect } from 'react-redux';
import ReactControlPanel from 'react-control-panel';

import { faustEditorContextMap, FaustEditorReduxInfra } from 'src/faustEditor';
import { mkStopInstanceHandler, mkCompileButtonClickHandler } from 'src/faustEditor/FaustEditor';

const mapSmallViewCompStateToProps = (state: FaustEditorReduxInfra['__fullState']) => ({
  instance: state.faustEditor.instance,
  faustCode: state.faustEditor.editorContent,
});

export const mkFaustEditorSmallView = (vcId: string) => {
  const SmallViewCompInner: React.FC<{} & ReturnType<typeof mapSmallViewCompStateToProps>> = ({
    instance,
    faustCode,
  }) => {
    const [optimize, setOptimize] = useState(false);
    const [compileErr, setCompileErr] = useState(false);

    // Whenever the instance changes, it's possible that our params have changed as well, so we have to update the UI.
    const uiDescriptor = useMemo(() => {
      // This is a bit dirty.  The overridden params aren't actually stored in Redux; they're stored in the mutable
      // `faustEditorContextMap`, and we use the change of the `instance` value as an indicator that those have updated.
      const context = faustEditorContextMap[vcId];
      if (!context) {
        throw new Error(
          `No Faust editor context for vcId ${vcId} while rendering the small view UI`
        );
      }

      return {
        context,
        settings: Object.entries(context.overrideableParams).map(([key, val]) => ({
          label: key,
          type: 'range',
          min: val.wrappedParam.minValue,
          max: val.wrappedParam.maxValue,
          // Convert from offset from the default to absolute
          initial: val.manualControl.offset.value + val.wrappedParam.defaultValue,
          manualControl: val.manualControl,
        })),
        overrideableParams: context.overrideableParams,
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [instance]);

    const start = useMemo(() => {
      if (!uiDescriptor.context.analyzerNode) {
        throw new Error(
          `No \`analyzerNode\` set in context for Faust editor with vcId ${vcId} when start button pressed`
        );
      }

      return mkCompileButtonClickHandler({
        faustCode,
        optimize,
        setErrMessage: msg => setCompileErr(!!msg),
        vcId,
        analyzerNode: uiDescriptor.context.analyzerNode,
        noBuildControlPanel: true,
      });
    }, [uiDescriptor, faustCode, optimize]);

    const stop = useMemo(() => {
      if (!instance) {
        return undefined;
      }

      const {
        context: { reduxInfra, ...context },
      } = uiDescriptor;
      return mkStopInstanceHandler({ reduxInfra, vcId, context });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [instance]);

    if (!instance) {
      return (
        <div>
          <input type='checkbox' checked={optimize} onChange={() => setOptimize(!optimize)} />
          <button
            onClick={() => {
              setCompileErr(false);
              start();
            }}
          >
            Start
          </button>
          {compileErr ? (
            <>
              <br />
              <span style={{ color: 'red' }}>
                There was an error while compiling; checking the main Faust Editor tab for more
                info.
              </span>
            </>
          ) : null}
        </div>
      );
    }

    const { settings, overrideableParams } = uiDescriptor;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
        <button onClick={stop}>Stop</button>
        <ReactControlPanel
          style={{ width: '100%' }}
          settings={settings}
          onChange={(label: string, val: number) => {
            const targetParam = overrideableParams[label];
            if (!targetParam) {
              console.error(
                `No \`overrideableParams\` entry for label "${label}"; not updating override value`
              );
              return;
            }
            if (typeof val !== 'number') {
              console.warn(
                `Non-numeric value got for param with label "${label}" in Faust editor small UI; casting to number and replacing \`NaN\`s with 0...`
              );
              val = +val;
              if (Number.isNaN(val)) {
                val = 0;
              }
            }

            // What we really want is offset from the default value.  The offset from the default set into the manual control CSN will be added to the
            // default of the worklet `AudioParam` and equal the value that was actually chosen in the UI.
            targetParam.manualControl.offset.value =
              val - overrideableParams[label].wrappedParam.defaultValue;
          }}
        />
      </div>
    );
  };

  return connect(mapSmallViewCompStateToProps)(SmallViewCompInner);
};
