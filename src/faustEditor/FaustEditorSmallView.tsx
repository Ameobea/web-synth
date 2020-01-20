import React, { useMemo, useState } from 'react';
import { connect } from 'react-redux';

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

    const instanceContext = faustEditorContextMap[vcId];
    if (!instanceContext) {
      throw new Error(`No entry in \`faustEditorContextMap\` for vcId "${vcId}"`);
    }

    const start = useMemo(() => {
      if (!instanceContext.analyzerNode) {
        throw new Error(
          `No \`analyzerNode\` set in context for Faust editor with vcId ${vcId} when start button pressed`
        );
      }

      return mkCompileButtonClickHandler({
        faustCode,
        optimize,
        setErrMessage: msg => setCompileErr(!!msg),
        vcId,
        analyzerNode: instanceContext.analyzerNode,
      });
    }, [instanceContext, faustCode, optimize]);

    const stop = useMemo(() => {
      if (!instance) {
        return undefined;
      }

      return mkStopInstanceHandler({
        reduxInfra: instanceContext.reduxInfra,
        vcId,
        context: instanceContext,
      });
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

    return (
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
        <button onClick={stop}>Stop</button>
        {instanceContext.reduxInfra.getState().faustEditor.controlPanel}
      </div>
    );
  };

  return connect(mapSmallViewCompStateToProps)(SmallViewCompInner);
};
