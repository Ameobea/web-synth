import * as R from 'ramda';
import React, { useMemo, useState } from 'react';
import ControlPanel from 'react-control-panel';
import { shallowEqual, useSelector } from 'react-redux';

import { faustEditorContextMap } from 'src/faustEditor';
import {
  compileFaustInstance,
  compileSoulInstance,
  mkCompileButtonClickHandler,
  mkStopInstanceHandler,
  type FaustEditorReduxStore,
} from 'src/faustEditor/FaustEditor';
import FlatButton from 'src/misc/FlatButton';

export const mkFaustEditorSmallView = (vcId: string) => {
  const SmallViewCompInner: React.FC = () => {
    const [compileErr, setCompileErr] = useState(false);
    const { ControlPanelComponent, language, instance } = useSelector(
      ({ faustEditor }: FaustEditorReduxStore) =>
        R.pick(['ControlPanelComponent', 'language', 'instance'], faustEditor),
      shallowEqual
    );

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
        setErrMessage: msg => setCompileErr(!!msg),
        vcId,
        analyzerNode: instanceContext.analyzerNode,
        compiler: language === 'faust' ? compileFaustInstance : compileSoulInstance,
      });
    }, [instanceContext.analyzerNode, language]);

    const stop = useMemo(() => {
      if (!instance) {
        return undefined;
      }

      return mkStopInstanceHandler(vcId);
    }, [instance]);
    const settings = useMemo(
      () => [
        {
          type: 'button',
          label: 'compile + start',
          action: () => {
            setCompileErr(false);
            start();
          },
        },
      ],
      [start]
    );

    if (!instance) {
      return (
        <div>
          <ControlPanel width={500} settings={settings} />

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

  return SmallViewCompInner;
};
