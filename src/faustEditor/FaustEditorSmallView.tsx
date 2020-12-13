import React, { useMemo, useState } from 'react';
import { connect } from 'react-redux';
import ControlPanel from 'react-control-panel';

import { faustEditorContextMap, FaustEditorReduxInfra } from 'src/faustEditor';
import { mkStopInstanceHandler, mkCompileButtonClickHandler } from 'src/faustEditor/FaustEditor';
import FlatButton from 'src/misc/FlatButton';

const mapSmallViewCompStateToProps = (state: ReturnType<FaustEditorReduxInfra['getState']>) => ({
  instance: state.faustEditor.instance,
  faustCode: state.faustEditor.editorContent,
});

export const mkFaustEditorSmallView = (vcId: string) => {
  const SmallViewCompInner: React.FC<ReturnType<typeof mapSmallViewCompStateToProps>> = ({
    instance,
    faustCode,
  }) => {
    const [optimize, setOptimize] = useState(true);
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
        vcId,
        context: instanceContext,
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [instance]);

    if (!instance) {
      return (
        <div>
          <ControlPanel
            style={{ width: 500 }}
            settings={[
              { type: 'checkbox', label: 'optimize', initial: true },
              {
                type: 'button',
                label: 'compile + start',
                action: () => {
                  setCompileErr(false);
                  start();
                },
              },
            ]}
            onChange={(key: string, val: any) => {
              switch (key) {
                case 'optimize': {
                  setOptimize(val);
                  break;
                }
                default: {
                  console.warn('Unhandled key in faust editor small view RCP: ', key);
                }
              }
            }}
          />

          {compileErr ? (
            <>
              <br />
              <span style={{ color: 'red' }}>
                There was an error while compiling; check the main Faust Editor tab for more info.
              </span>
            </>
          ) : null}
        </div>
      );
    }

    const { ControlPanelComponent } = instanceContext.reduxInfra.getState().faustEditor;
    if (!ControlPanelComponent) {
      return null;
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
        <ControlPanelComponent position={null} draggable={false} />
        <FlatButton onClick={stop}>Stop</FlatButton>
      </div>
    );
  };

  return connect(mapSmallViewCompStateToProps)(SmallViewCompInner);
};
