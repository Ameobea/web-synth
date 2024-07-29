import downloadjs from 'downloadjs';
import React, { useMemo } from 'react';
import ControlPanel from 'react-control-panel';
import { useSelector } from 'react-redux';

import './SinsyUI.css';
import FileUploader, { type FileUploaderValue } from 'src/controls/FileUploader';
import { actionCreators, dispatch, type ReduxStore } from 'src/redux';
import { loadHTSVoice } from 'src/vocalSynthesis/sinsyViewContext';

const SinsyUI: React.FC<{ vcId: string }> = ({ vcId }) => {
  const { selectedHtsVoice, musicXml, sinsyModule } = useSelector((state: ReduxStore) => {
    const { selectedHtsVoice, musicXml } = state.sinsy.instances[vcId];
    return { sinsyModule: state.sinsy.sinsyModule, selectedHtsVoice, musicXml };
  });
  const settings = useMemo(
    () => [
      {
        label: 'selected hts voice',
        type: 'select',
        // TODO: Include user-uploaded voices
        options: { '': '', nitech_jp_song070_f001: 'nitech_jp_song070_f001' },
      },
      { type: 'custom', label: 'upload musicxml', renderContainer: false, Comp: FileUploader },
      {
        type: 'button',
        label: 'generate',
        action: async () => {
          if (!selectedHtsVoice) {
            alert('Must select a HTS voice to use');
            return;
          } else if (!musicXml) {
            alert('Must upload a MusicXML file to use');
            return;
          } else if (!sinsyModule) {
            alert('Sinsy is not yet loaded...');
            return;
          }

          const htsVoiceData = await loadHTSVoice(selectedHtsVoice);

          // Emscripten really relies on `Module` being available globally
          const oldModule = (window as any).Module;
          (window as any).Module = sinsyModule;

          try {
            // Write the voice into the Emscripten virtual filesystem
            sinsyModule.FS.writeFile('voice.htsvoice', htsVoiceData);

            console.log('HTS voice written into Emscripten virtual FS; running Sinsy...');
            sinsyModule.run_sinsy(musicXml.fileContent);

            console.log('Done running Sinsy!  Retrieving generated Wav file...');
            const file = Module.FS.readFile('out.wav', { encoding: 'binary' });

            downloadjs(file, 'sinsy.wav', 'audio/wav');
          } finally {
            (window as any).Module = oldModule;
          }
        },
      },
    ],
    [musicXml, selectedHtsVoice, sinsyModule]
  );

  return (
    <div className='sinsy-ui'>
      <ControlPanel
        style={{ width: 800 }}
        settings={settings}
        state={{
          'selected hts voice': selectedHtsVoice ?? '',
          'upload musicxml': musicXml ? { fileName: musicXml.fileName } : null,
        }}
        onChange={(key: string, val: any) => {
          switch (key) {
            case 'selected hts voice': {
              dispatch(actionCreators.sinsy.SET_SELECTED_HTS_VOICE(vcId, val ? val : null));
              break;
            }
            case 'upload musicxml': {
              const decoder = new TextDecoder();
              const musicXml: FileUploaderValue = val;
              const fileContent = decoder.decode(new Uint8Array(musicXml.fileContent));
              dispatch(
                actionCreators.sinsy.SET_SINSY_MUSICXML(vcId, {
                  fileName: musicXml.fileName,
                  fileContent,
                })
              );
              break;
            }
            default: {
              console.error('Unhandled key in sinsy control panel: ', key);
            }
          }
        }}
      />
    </div>
  );
};

export default SinsyUI;
