/**
 * Defines a node that allows for a MIDI editor's audio output node to be connected as an input to
 * the audio graph.
 */

import * as R from 'ramda';
import { LiteGraph, LGAudio } from 'litegraph.js';

import { getState } from 'src/redux';
import { swapAudioNodes } from './util';

/**
 * Returns the VC definitions of all MIDI editor VCs
 */
const getMidiEditorVcs = () =>
  getState().viewContextManager.activeViewContexts.filter(R.propEq('name', 'midi_editor'));

export const registerMidiEditorNode = () => {
  function LGMidiEditorModule(this: any) {
    // Create a placeholder `audionode` that prevents errors from getting thrown when the node is
    // first created, before it has compiled its code.
    const audioCtx: AudioContext = LGAudio.getAudioContext();
    this.audionode = new GainNode(audioCtx, { gain: 0 });

    const midiEditorVCs = getMidiEditorVcs();
    if (R.isEmpty(midiEditorVCs)) {
      throw new Error("No MIDI editors are available; can't initialize MIDE editor graph node");
    }

    // Default Properties
    this.properties = {
      vcId: midiEditorVCs[0].uuid,
    };

    this.addProperty('vcId', midiEditorVCs[0].uuid, 'enum', {
      values: midiEditorVCs.map(R.prop('uuid')),
    });

    const instanceForCurrentEditor = getState().synths.synthsByVCId[midiEditorVCs[0].uuid];
    if (!instanceForCurrentEditor) {
      throw new Error(`No MIDI editor set for VC with id ${midiEditorVCs[0].uuid}`);
    }
    swapAudioNodes(this, instanceForCurrentEditor.volume);

    this.addOutput('out', 'audio');
  }

  LGAudio.createAudioNodeWrapper(LGMidiEditorModule);

  LGMidiEditorModule.title = 'MIDI Editor';
  LGMidiEditorModule.desc =
    'A node that wraps a MIDI editor, passing through its output as an input into the audio graph';

  LiteGraph.registerNodeType('audio/midiEditor', LGMidiEditorModule);
};
