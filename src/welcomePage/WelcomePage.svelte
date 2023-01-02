<script lang="ts">
  import DemoTile from 'src/welcomePage/DemoTile.svelte';

  let isLoadingComposition = false;
</script>

<div class="root">
  <h1>Web Synth</h1>

  <p>
    Web Synth is an open source browser-based audio synthesis platform. It is built around a
    node-based modular workflow, but it also has support for DAW-like features like a MIDI editor,
    sequencer, and and looper.
  </p>

  <div class="links">
    <!-- svelte-ignore security-anchor-rel-noreferrer -->
    <a target="_blank" href="https://github.com/ameobea/web-synth">GitHub</a>
    <!-- svelte-ignore security-anchor-rel-noreferrer -->
    <a target="_blank" href="https://www.youtube.com/watch?v=kgkpJk0P7Uo">Demo Video</a>
    <!-- svelte-ignore security-anchor-rel-noreferrer -->
    <a target="_blank" href="https://notes.ameo.design/docs/">Docs</a>
  </div>

  <h2 style="margin-bottom: 10px;">Demos</h2>
  <div class="demos">
    <DemoTile
      title="Multi-Instrument Song"
      description="A winter-y looping song made using a variety of web synth modules"
      compositionID="60"
      {isLoadingComposition}
      image="/demo-images/vibey-winter.jpg"
      imageAlt="A screenshot of the web synth audio graph editor for the 'Vibey Winter' composition.  It shows several connected modules including some synthesizers, a band splitter, filters, a reverb, and a mixer."
      imageWidth={1692}
      imageHeight={1692}
    />
    <DemoTile
      title="Modern Talking Wavetable"
      description="The famous Modern Talking wavetable imported into Web Synth with FM and other web synth features"
      compositionID="46"
      {isLoadingComposition}
      image="/demo-images/modern-talking.jpg"
      imageAlt="A screenshot of the web synth control panel for the modern talking demo. Shows several sliders for controlling frequency modulation, volume, detune, LFO envelope length, and reverb room size.  Has a colorful spectrogram on the right showing the frequencies in the sound produced by the synthesizer.  Has an on-screen MIDI keyboard on the bottom that can be used to control the demo; the notes are labeled with keys on the computer keyboard."
      imageWidth={1174}
      imageHeight={1174}
    />
    <DemoTile
      title="Generative Modular Patch"
      description="Lots of modulation with randomness + LFOs with a FM synth"
      compositionID="79"
      {isLoadingComposition}
      image="/demo-images/modular-esque.jpg"
      imageAlt="A screenshot of the web synth audio graph editor for the modular-esque composition. It shows several different sources of modulation including both LFOs and stepped randomness for a variety of synth designer parameters as well as scale & shift nodes."
      imageWidth={1530}
      imageHeight={1530}
    />
    <DemoTile
      title="Physically-Modeled Bell"
      description="A physically-modeled bell from the Faust standard library compiled to WebAssembly"
      compositionID="81"
      {isLoadingComposition}
      image="/demo-images/faust-bells.jpg"
      imageAlt="A screenshot of the web synth code editor UI.  Shows some source code for the physically modeled bell and some buttons with labels like 'compile' and 'save program'."
      imageWidth={1214}
      imageHeight={1214}
    />
  </div>

  <h2>Features</h2>
  <div class="features">
    <ul>
      <li>
        <details>
          <summary>Versatile 8-operator polyphonic FM Synthesizer</summary>

          <ul>
            <li>
              Supports many primitive waveforms as well as loading
              <!-- svelte-ignore security-anchor-rel-noreferrer -->
              wavetables from <a target="_blank" href="https://synthtech.com/waveedit/">WaveEdit</a>
              or other sources
            </li>
            <li>
              Contains a number of built-in effects from basics like bitcrusher and filters to
              OTT-style multiband compression and wavefolding
            </li>
            <li>
              Highly modulatable and patchable with sample-level parameter automation via other
              modules or built-in per-voice envelope generators
            </li>
          </ul>
        </details>
      </li>
      <li>
        <details>
          <summary>Fully functional MIDI editor</summary>
          <ul>
            <li>MIDI file import and export</li>
            <li>Multi-note selection and editing</li>
            <li>Record live from keyboard or other input source</li>
            <li>Live playback and preview</li>
          </ul>
        </details>
      </li>
      <li>Two programmable loopers for samples and MIDI</li>
      <li>
        <details>
          <summary>
            <!-- svelte-ignore security-anchor-rel-noreferrer -->
            Dynamic compilation of DSP code written in
            <a target="_blank" href="https://faust.grame.fr/">Faust</a>
            <!-- svelte-ignore security-anchor-rel-noreferrer -->
            and <a target="_blank" href="https://soul.dev">Soul</a> via WebAssembly</summary
          >
          <ul>
            <li>
              Facilitates infinite custom effects using existing code with minimal or no changes
              required
            </li>
            <li>
              Parameters are fully integrated into the web synth patching system allowing them to be
              modulated by other components or controlled live by auto-generated UI
            </li>
          </ul>
        </details>
      </li>
      <li>Preset and composition sharing/loading system for many of web synth's components</li>
      <li>Modular synth-style utilities like LFOs, random voltage sources, and quantizers</li>
      <li>Variety of visualizers including oscilloscope and spectrum analyzer</li>
      <li>Support for building custom UIs with many input types and markdown notes</li>
      <li>Supports hardware MIDI keyboards and controllers via WebMIDI</li>
      <li>
        Many other miscellaneous tools and modules like visual filter designer, granular
        synthesizer, delays, signal debuggers, and more
      </li>
    </ul>
  </div>
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
    /* align-items: center; */
    padding-left: 30px;
    padding-right: 30px;
    background-color: #1b1b1b;
    max-width: 1500px;
    margin: auto;
    box-sizing: border-box;
    font-size: 18px;
  }

  h1 {
    font-family: 'Hack', 'Oxygen Mono', 'Input Mono', 'Consolas', monospace;
    margin-top: 30px;
    margin-bottom: 30px;
  }

  p {
    max-width: 1000px;
    line-height: 1.5;
  }

  .links {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    width: 100%;
    max-width: 300px;
    margin-top: 20px;
    margin-bottom: 10px;
    font-size: 24px;
  }

  .demos {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    margin-bottom: 20px;
    justify-content: space-between;
  }

  h2 {
    margin-bottom: 0px;
    font-size: 34px;
  }

  .features {
    max-width: 1000px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: flex-start;
    width: calc(min(100%, 1000px) - 100px);
  }

  ul {
    line-height: 1.8;
  }

  details:not([open]) {
    cursor: pointer;
  }

  details[open] summary {
    cursor: pointer;
  }
</style>
