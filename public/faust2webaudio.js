/*
 faust2webaudio

 Primarily written by Myles Borins
 During the Spring 2013 offering of Music 420b with Julius Smith
 A bit during the Summer of 2013 with the help of Joshua Kit Clayton
 And finally a sprint during the late fall of 2013 to get everything working
 A Special thanks to Yann Orlarey and Stéphane Letz

 faust2webaudio is distributed under the terms the MIT or GPL2 Licenses.
 Choose the license that best suits your project. The text of the MIT and GPL
 licenses are at the root directory.

 Additional code: GRAME 2014-2019

 Modified to work with this application by Casey Primozic
 Same licenses apply as original (MIT + GPL2)
*/

'use strict';

/**
 * @class FaustWasm2ScriptProcessor
 * @property {string} name - name of current DSP
 * @property {{ [key: string]: any }} dspProps - dsp properties
 * @property {any[]} _log - event log
 * @property {string[]} node - ScriptProcessorNode
 * @property {boolean} debug - debug mode
 */
class FaustWasm2ScriptProcessor {
  /**
   * Creates an instance of FaustWasm2ScriptProcessor.
   * @param {string} dspName - dsp name
   * @param {{ debug: boolean, [key: string]: any }} options - compile options
   */
  constructor(dspName, options) {
    this.name = dspName;
    this._log = [];
    this.debug = false || (typeof options === 'object' && options.debug);
  }

  heap2Str(buf) {
    let str = '';
    let i = 0;
    while (buf[i] !== 0) {
      str += String.fromCharCode(buf[i++]);
    }
    return str;
  }

  /**
   * Constructor of Monophonic Faust DSP
   *
   * @param {WebAssembly.Instance} dspInstance - the wasm instance
   * @param {AudioContext | webkitAudioContext} audioCtx - the Web Audio context
   * @param {number} bufferSize - the buffer_size in frames
   *
   * @returns {ScriptProcessorNode} a valid WebAudio ScriptProcessorNode object or null
   */
  getNode(dspInstance, audioCtx, bufferSize) {
    // JSON is as offset 0
    const HEAPU8 = new Uint8Array(dspInstance.exports.memory.buffer);
    this.json = this.heap2Str(HEAPU8);
    this.json_object = JSON.parse(this.json);

    let sp;
    const inputs = parseInt(this.json_object.inputs);
    const outputs = parseInt(this.json_object.outputs);
    try {
      sp = audioCtx.createScriptProcessor(bufferSize, inputs, outputs);
    } catch (e) {
      this.error('Error in createScriptProcessor: ' + e);
      return null;
    }

    sp.json_object = this.json_object;
    sp.output_handler = null;
    sp.ins = null;
    sp.outs = null;
    sp.compute_handler = null;

    sp.dspInChannnels = [];
    sp.dspOutChannnels = [];

    sp.fPitchwheelLabel = [];
    (sp.fCtrlLabel = new Array(128).fill(null).map(() => [])), (sp.numIn = inputs);
    sp.numOut = outputs;

    this.log(sp.numIn);
    this.log(sp.numOut);

    // Memory allocator
    sp.ptr_size = 4;
    sp.sample_size = 4;

    sp.factory = dspInstance.exports;
    sp.HEAP = dspInstance.exports.memory.buffer;
    sp.HEAP32 = new Int32Array(sp.HEAP);
    sp.HEAPF32 = new Float32Array(sp.HEAP);

    this.log(sp.HEAP);
    this.log(sp.HEAP32);
    this.log(sp.HEAPF32);

    // JSON is as offset 0
    /*
        var HEAPU8 = new Uint8Array(sp.HEAP);
        console.log(this.Heap2Str(HEAPU8));
        */
    // bargraph
    sp.outputs_timer = 5;
    sp.outputs_items = [];

    // input items
    sp.inputs_items = [];

    // Start of HEAP index

    // DSP is placed first with index 0. Audio buffer start at the end of DSP.
    sp.audio_heap_ptr = parseInt(this.json_object.size);

    // Setup pointers offset
    sp.audio_heap_ptr_inputs = sp.audio_heap_ptr;
    sp.audio_heap_ptr_outputs = sp.audio_heap_ptr_inputs + sp.numIn * sp.ptr_size;

    // Setup buffer offset
    sp.audio_heap_inputs = sp.audio_heap_ptr_outputs + sp.numOut * sp.ptr_size;
    sp.audio_heap_outputs = sp.audio_heap_inputs + sp.numIn * bufferSize * sp.sample_size;

    // Start of DSP memory : DSP is placed first with index 0
    sp.dsp = 0;

    sp.pathTable = [];

    sp.update_outputs = () => {
      if (sp.outputs_items.length > 0 && sp.output_handler && sp.outputs_timer-- === 0) {
        sp.outputs_timer = 5;
        sp.outputs_items.forEach(item =>
          sp.output_handler(item, sp.factory.getParamValue(sp.dsp, sp.pathTable[item]))
        );
      }
    };

    sp.compute = e => {
      for (let i = 0; i < sp.numIn; i++) {
        // Read inputs
        const input = e.inputBuffer.getChannelData(i);
        const dspInput = sp.dspInChannnels[i];
        dspInput.set(input);
      }
      // Possibly call an externally given callback (for instance to synchronize playing a MIDIFile...)
      if (sp.compute_handler) sp.compute_handler(bufferSize);
      sp.factory.compute(sp.dsp, bufferSize, sp.ins, sp.outs); // Compute
      sp.update_outputs(); // Update bargraph
      for (let i = 0; i < sp.numOut; i++) {
        // Write outputs
        const output = e.outputBuffer.getChannelData(i);
        const dspOutput = sp.dspOutChannnels[i];
        output.set(dspOutput);
      }
    };
    // JSON parsing
    sp.parse_ui = ui => ui.forEach(group => sp.parse_group(group));
    sp.parse_group = group => (group.items ? sp.parse_items(group.items) : null);
    sp.parse_items = items => items.forEach(item => sp.parse_item(item));
    sp.parse_item = item => {
      if (item.type === 'vgroup' || item.type === 'hgroup' || item.type === 'tgroup') {
        sp.parse_items(item.items);
      } else if (item.type === 'hbargraph' || item.type === 'vbargraph') {
        // Keep bargraph adresses
        sp.outputs_items.push(item.address);
        sp.pathTable[item.address] = parseInt(item.index);
      } else if (
        item.type === 'vslider' ||
        item.type === 'hslider' ||
        item.type === 'button' ||
        item.type === 'checkbox' ||
        item.type === 'nentry'
      ) {
        // Keep inputs adresses
        sp.inputs_items.push(item.address);
        sp.pathTable[item.address] = parseInt(item.index);
        if (!item.meta) return;
        item.meta.forEach(meta => {
          const midi = meta.midi;
          if (!midi) return;
          const strMidi = midi.trim();
          if (strMidi === 'pitchwheel') {
            sp.fPitchwheelLabel.push(item.address);
          } else {
            const matched = strMidi.match(/^ctrl\s(\d+)/);
            if (!matched) return;
            sp.fCtrlLabel[parseInt(matched[1])].push({
              path: item.address,
              min: parseFloat(item.min),
              max: parseFloat(item.max),
            });
          }
        });
      }
    };
    sp.initAux = () => {
      // Setup web audio context
      this.log('buffer_size ' + bufferSize);
      sp.onaudioprocess = sp.compute;
      if (sp.numIn > 0) {
        sp.ins = sp.audio_heap_ptr_inputs;
        for (let i = 0; i < sp.numIn; i++) {
          sp.HEAP32[(sp.ins >> 2) + i] = sp.audio_heap_inputs + bufferSize * sp.sample_size * i;
        }
        // Prepare Ins buffer tables
        const dspInChans = sp.HEAP32.subarray(sp.ins >> 2, (sp.ins + sp.numIn * sp.ptr_size) >> 2);
        for (let i = 0; i < sp.numIn; i++) {
          sp.dspInChannnels[i] = sp.HEAPF32.subarray(
            dspInChans[i] >> 2,
            (dspInChans[i] + bufferSize * sp.sample_size) >> 2
          );
        }
      }
      if (sp.numOut > 0) {
        sp.outs = sp.audio_heap_ptr_outputs;
        for (let i = 0; i < sp.numOut; i++) {
          sp.HEAP32[(sp.outs >> 2) + i] = sp.audio_heap_outputs + bufferSize * sp.sample_size * i;
        }
        // Prepare Out buffer tables
        const dspOutChans = sp.HEAP32.subarray(
          sp.outs >> 2,
          (sp.outs + sp.numOut * sp.ptr_size) >> 2
        );
        for (let i = 0; i < sp.numOut; i++) {
          sp.dspOutChannnels[i] = sp.HEAPF32.subarray(
            dspOutChans[i] >> 2,
            (dspOutChans[i] + bufferSize * sp.sample_size) >> 2
          );
        }
      }
      // Parse JSON UI part
      sp.parse_ui(this.json_object.ui);
      // Init DSP
      sp.factory.init(sp.dsp, audioCtx.sampleRate);
    };

    sp.getSampleRate = () => audioCtx.sampleRate; // Return current sample rate
    sp.getNumInputs = () => sp.numIn; // Return instance number of audio inputs.
    sp.getNumOutputs = () => sp.numOut; // Return instance number of audio outputs.
    /**
     * Global init, doing the following initialization:
     * - static tables initialization
     * - call 'instanceInit': constants and instance state initialisation
     *
     * @param {number} sampleRate - the sampling rate in Hertz
     */
    sp.init = sampleRate => sp.factory.init(sp.dsp, sampleRate);

    /**
     * Init instance state.
     *
     * @param {number} sampleRate - the sampling rate in Hertz
     */
    sp.instanceInit = sampleRate => sp.factory.instanceInit(sp.dsp, sampleRate);

    /**
     * Init instance constant state.
     *
     * @param {number} sampleRate - the sampling rate in Hertz
     */
    sp.instanceConstants = sampleRate => sp.factory.instanceConstants(sp.dsp, sampleRate);

    /* Init default control parameters values. */
    sp.instanceResetUserInterface = () => sp.factory.instanceResetUserInterface(sp.dsp);

    /* Init instance state (delay lines...).*/
    sp.instanceClear = () => sp.factory.instanceClear(sp.dsp);

    /**
     * Trigger the Meta handler with instance specific calls to 'declare' (key, value) metadata.
     *
     * @param {{ declare: (string, any) => any }} handler - the Meta handler as a 'declare' function of type (key, value)
     */
    sp.metadata = handler => {
      if (this.json_object.meta) {
        this.json_object.meta.forEach(meta =>
          handler.declare(Object.keys(meta)[0], Object.values(meta)[0])
        );
      }
    };

    /**
     * Setup a control output handler with a function of type (path, value)
     * to be used on each generated output value. This handler will be called
     * each audio cycle at the end of the 'compute' method.
     *
     * @param {{ declare: (string, any) => any }} handler - a function of type function(path, value)
     */
    sp.setOutputParamHandler = handler => (sp.output_handler = handler);

    /**
     * Get the current output handler.
     */
    sp.getOutputParamHandler = () => sp.output_handler;
    /**
     * Control change
     *
     * @param {number} channel - the MIDI channel (0..15, not used for now)
     * @param {number} ctrl - the MIDI controller number (0..127)
     * @param {number} value - the MIDI controller value (0..127)
     */

    sp.ctrlChange = (channel, ctrl, value) => {
      if (!sp.fCtrlLabel[ctrl].length) return;
      const remap = (v, mn0, mx0, mn1, mx1) => ((v - mn0) / (mx0 - mn0)) * (mx1 - mn1) + mn1;
      sp.fCtrlLabel[ctrl].forEach(ctrl => {
        const path = ctrl.path;
        sp.setParamValue(path, remap(value, 0, 127, ctrl.min, ctrl.max));
        if (sp.output_handler) sp.output_handler(path, sp.getParamValue(path));
      });
    };

    /**
     * PitchWeel
     *
     * @param {number} channel - the MIDI channel (0..15, not used for now)
     * @param {number} value - the MIDI controller value (-1..1)
     */

    sp.pitchWheel = (channel, wheel) => {
      sp.fPitchwheelLabel.forEach(path => {
        sp.setParamValue(path, Math.pow(2, wheel / 12));
        if (sp.output_handler) sp.output_handler(path, sp.getParamValue(path));
      });
    };

    /**
     * Set control value.
     *
     * @param {string} path - the path to the wanted control (retrieved using 'getParams' method)
     * @param {number} val - the float value for the wanted parameter
     */

    sp.setParamValue = (path, val) => sp.factory.setParamValue(sp.dsp, sp.pathTable[path], val);
    /**
     * Get control value.
     *
     * @param {string} path - the path to the wanted control (retrieved using 'controls' method)
     *
     * @return {number} the float value
     */

    sp.getParamValue = path => sp.factory.getParamValue(sp.dsp, sp.pathTable[path]);
    /**
     * Get the table of all input parameters paths.
     *
     * @return {object} the table of all input parameter paths.
     */
    sp.getParams = () => sp.inputs_items;

    // Init resulting DSP
    sp.initAux();
    return sp;
  }

  log(str) {
    this._log.push(str);
    if (this.debug) console.log(str);
  }

  error(str) {
    this._log.push(str);
    console.error(str);
  }
}

window.FaustWasm2ScriptProcessor = FaustWasm2ScriptProcessor;
