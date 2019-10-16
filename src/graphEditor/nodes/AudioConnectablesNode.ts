/**
 * Defines a graph node that wraps an `AudioConnectables` instance.  It
 */

import { LiteGraph } from 'litegraph.js';

import { AudioConnectables } from 'src/patchNetwork';

export const registerAudioConnectablesNode = () => {
  function LGAudioConnectables(this: any) {
    // Default Properties
    this.properties = {};
  }

  LGAudioConnectables.setConnectables = function(this: any, connectables: AudioConnectables) {
    // Store the raw inputs and outputs for later direct access
    this.connectables = connectables;

    this.context = new AudioContext();

    [...connectables.inputs.entries()].forEach(([name, input]) => {
      if (input instanceof AudioParam) {
        // TODO: Look up this type dynamically?
        this.addProperty(name, input.value, 'number');
      } else {
        this.addInput(name, 'audio');
      }
    });
  };

  LGAudioConnectables.prototype.onPropertyChanged = function(name: string, value: any) {
    const node = (this.connectables as AudioConnectables).inputs.get(name);
    if (!node) {
      console.error(`No input named "${name}" found on connectables for node`);
      return;
    } else if (!(node instanceof AudioParam)) {
      console.error(`Input named "${name}" is not an instance of \`AudioParam\``);
      return;
    }

    node.setValueAtTime(value, (this.ctx as AudioContext).currentTime);
  };

  LGAudioConnectables.onConnectionsChange = function(connection, slot, connected, link_info) {
    // TODO: Dispatch events to update the patch network with the new connection.  This will cause the actual audio nodes to get
    // connected from within Redux.
    console.log('Connections changed on audio connectables node: ', {
      connection,
      slot,
      connected,
      link_info,
    });
  };

  LiteGraph.registerNodeType('audio/audioConnectables', LGAudioConnectables);
};
