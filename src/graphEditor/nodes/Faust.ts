/**
 * Defines a graph node that wraps a Faust program.  It can function as an audio processing node
 * and connect with all of the other nodes that the graph editor supports.
 */

import * as R from 'ramda';
import { LGAudio } from 'litegraph.js';

import { store } from '../../redux';

function LGFaustModule() {
  // Default Properties
  this.properties = {
    moduleId: null,
  };

  // TODO: fetch this if needed
  const modules: { id: number; title: string; description: string; code: string }[] = (() => {
    console.log('getState');
    return store.getState().effects.sharedEffects;
  })();

  this.addProperty('moduleId', modules[0].title, 'enum', { values: modules.map(R.prop('title')) });

  //create node
  var ctx = LGAudio.getAudioContext();
  if (ctx.createScriptProcessor) {
    this.audionode = ctx.createScriptProcessor(4096, 1, 1);
  }
  //buffer size, input channels, output channels
  else {
    console.warn('ScriptProcessorNode deprecated');
    this.audionode = ctx.createGain(); //bypass audio
  }

  this.processCode();
  if (!LGAudioScript._bypass_function) {
    LGAudioScript._bypass_function = this.audionode.onaudioprocess;
  }

  // TODO: Make this dynamic
  this.addInput('in', 'audio');
  this.addOutput('out', 'audio');
}
