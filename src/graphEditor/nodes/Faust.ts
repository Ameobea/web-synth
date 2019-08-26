/**
 * Defines a graph node that wraps a Faust program.  It can function as an audio processing node
 * and connect with all of the other nodes that the graph editor supports.
 */

import * as R from 'ramda';
import { LiteGraph, LGAudio } from 'litegraph.js';
import { Option } from 'funfix-core';

import { compileFaustInstance } from '../../faustEditor/FaustEditor';
import { Effect } from '../../redux/reducers/effects';

export const registerFaustNode = (availableModules: Effect[]) => {
  function LGFaustModule() {
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

    console.log('compiling initial instance');
    this.compileActiveInstance();

    // TODO: Make this dynamic based off of Faust module definition or sth
    this.addInput('in', 'audio');
    this.addOutput('out', 'audio');
  }

  LGFaustModule.prototype.compileActiveInstance = async function() {
    const { code, title } = availableModules.find(
      R.propEq('title', this.properties.faustModuleTitle)
    )!;
    console.log(`Compiling Faust instance with title "${title}"`);
    const newAudioNode = await compileFaustInstance(code, undefined, false);

    // Dispose of the old audio node and replace it with the new one
    (this.audionode as AudioNode).disconnect();
    this.audionode = newAudioNode;

    // connect all inputs to the newly created audio node
    let i = 0;
    while (true) {
      const inputAudioNode = Option.of(this.getInputNode(i) as (null | { audionode?: AudioNode }))
        .map(R.prop('audionode'))
        .orNull();

      if (!inputAudioNode) {
        break;
      }

      inputAudioNode.connect(this.audionode);
      i += 1;
    }

    // connect the newly created node to all outputs
    let slot = 0;
    while (true) {
      const outputNodesForSlot = this.getOutputNodes(slot) as null | { audionode?: AudioNode }[];
      if (!outputNodesForSlot) {
        break;
      }

      outputNodesForSlot.forEach(({ audionode: outputAudioNode }) => {
        if (!outputAudioNode) {
          return;
        }

        this.audionode.connect(outputAudioNode);
      });

      slot += 1;
    }

    console.log('Done compiling');
  };

  LGFaustModule.prototype.onPropertyChanged = function(name, value) {
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

  // idk what this does but I copy/pasted it from the script processor example
  LGFaustModule.default_function = function() {
    this.onaudioprocess = function(audioProcessingEvent) {
      // The input buffer is the song we loaded earlier
      var inputBuffer = audioProcessingEvent.inputBuffer;

      // The output buffer contains the samples that will be modified and played
      var outputBuffer = audioProcessingEvent.outputBuffer;

      // Loop through the output channels (in this case there is only one)
      for (var channel = 0; channel < outputBuffer.numberOfChannels; channel++) {
        var inputData = inputBuffer.getChannelData(channel);
        var outputData = outputBuffer.getChannelData(channel);

        // Loop through the 4096 samples
        for (var sample = 0; sample < inputBuffer.length; sample++) {
          // make output equal to the same as the input
          outputData[sample] = inputData[sample];
        }
      }
    };
  };

  LGAudio.createAudioNodeWrapper(LGFaustModule);

  LGFaustModule.title = 'Faust Module';
  LGFaustModule.desc =
    'A node that wraps a Faust module, compiling it into an audio node and using it as a component in the audio graph';
  LiteGraph.registerNodeType('audio/faust', LGFaustModule);
};
