<script lang="ts">
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

  <h2 style="margin-bottom: 10px;">Try It</h2>
  <div class="demos">
    <div>TODO</div>
    <div>TODO</div>
    <div>TODO</div>
    <div>TODO</div>
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
    align-items: center;
    background-color: #1b1b1b;
    height: 100%;
    max-width: 1500px;
    margin: auto;
    box-sizing: border-box;
    font-size: 18px;
  }

  h1 {
    font-family: 'Hack', 'Oxygen Mono', 'Input Mono', 'Consolas', monospace;
    margin-top: 50px;
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
  }

  .demos > div {
    width: 300px;
    height: 300px;
    margin: 10px;
    background-color: #333;
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
</style>
