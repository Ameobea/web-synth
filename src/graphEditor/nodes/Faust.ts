/**
 * Defines a graph node that wraps a Faust program.  It can function as an audio processing node
 * and connect with all of the other nodes that the graph editor supports.
 */

import * as R from 'ramda';
import { LiteGraph, LGAudio } from 'litegraph.js';

import { compileFaustInstance } from 'src/faustEditor/FaustEditor';
import { Effect } from 'src/redux/modules/effects';
import { swapAudioNodes } from './util';

export const registerFaustNode = (availableModules: Effect[]) => {
  function LGFaustModule(this: any) {
    // Create a placeholder `audionode` that prevents errors from getting thrown when the node is
    // first created, before it has compiled its code.
    const audioCtx: AudioContext = LGAudio.getAudioContext();
    this.audionode = new GainNode(audioCtx, { gain: 0 });

    // Default Properties
    this.properties = {
      faustModuleTitle: null,
    };

    this.addProperty('faustModuleTitle', availableModules[0].title, 'enum', {
      values: availableModules.map(R.prop('title')),
    });

    this.compileActiveInstance();

    // TODO: Make this dynamic based off of Faust module definition or sth
    this.addInput('in', 'customAudio');
    this.addOutput('out', 'customAudio');
  }

  LGFaustModule.prototype.compileActiveInstance = async function() {
    const { code } = availableModules.find(R.propEq('title', this.properties.faustModuleTitle))!;
    const newAudioNode = await compileFaustInstance(code, true);

    swapAudioNodes(this, newAudioNode);
  };

  LGFaustModule.prototype.onPropertyChanged = function(name: string, value: unknown) {
    switch (name) {
      case 'faustModuleTitle': {
        this.properties.faustModuleTitle = value;
        this.compileActiveInstance();
        break;
      }
      default: {
        console.warn(`Unhandled option change in \`LGFaustModule\` with name "${name}"`);
      }
    }
  };

  // This is copy/pasted from the script processor example
  LGFaustModule.default_function = function(this: any) {
    this.onaudioprocess = function(audioProcessingEvent: AudioProcessingEvent) {
      // The input buffer is the song we loaded earlier
      const inputBuffer = audioProcessingEvent.inputBuffer;

      // The output buffer contains the samples that will be modified and played
      const outputBuffer = audioProcessingEvent.outputBuffer;

      // Loop through the output channels (in this case there is only one)
      for (let channel = 0; channel < outputBuffer.numberOfChannels; channel++) {
        const inputData = inputBuffer.getChannelData(channel);
        const outputData = outputBuffer.getChannelData(channel);

        // Loop through the 4096 samples
        for (let sample = 0; sample < inputBuffer.length; sample++) {
          // make output equal to the same as the input
          outputData[sample] = inputData[sample];
        }
      }
    };
  };

  LiteGraph.registerNodeType('audio/faust', LGFaustModule);
};
