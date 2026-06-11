<script lang="ts" module>
  const LazyEmbeddingBrowserInst = new AsyncOnce(
    () =>
      import('src/sampleLibrary/embeddingBrowser/EmbeddingBrowserUI/EmbeddingBrowserInst').then(
        mod => mod.EmbeddingBrowserInst
      ),
    true
  );
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';

  import type { EmbeddingBrowserInst } from 'src/sampleLibrary/embeddingBrowser/EmbeddingBrowserUI/EmbeddingBrowserInst';
  import type {
    AudioSampleEmbedding,
    AudioSampleEmbeddingSampleClickData,
  } from 'src/sampleLibrary/embeddingBrowser/EmbeddingBrowserUI/types';
  import type { SampleDescriptor } from 'src/sampleLibrary/sampleLibrary';
  import { PlayingSampleManager } from 'src/sampleLibrary/SampleLibraryUI/PlayingSampleManager';
  import { AsyncOnce } from 'src/util';

  interface Props {
    embedding: AudioSampleEmbedding;
    buildSampleDescriptor: (sampleName: string) => SampleDescriptor;
  }

  let { embedding, buildSampleDescriptor }: Props = $props();

  let windowHeight = $state(0);
  let windowWidth = $state(0);

  let container: HTMLDivElement | null = $state(null);
  let inst: EmbeddingBrowserInst | null = $state(null);

  const playingSampleManager = new PlayingSampleManager((_newPlayingSampleName: string) => {
    // playingSampleName = newPlayingSampleName;
  });

  onDestroy(() => playingSampleManager.dispose());

  const clickHandler = (datum: AudioSampleEmbeddingSampleClickData) => {
    const sampleDescriptor = buildSampleDescriptor(datum.sampleName);
    playingSampleManager.togglePlaying(sampleDescriptor);
  };

  let height = $derived(windowHeight - 220);
  let width = $derived(windowWidth - 500 - 80);

  $effect(() => {
    if (!inst && container && height > 0 && width > 0) {
      LazyEmbeddingBrowserInst.get().then(EmbeddingBrowserInst => {
        if (!container) {
          console.error('container is null in EmbeddingBrowserUI');
          return;
        }

        inst?.destroy();
        inst = new EmbeddingBrowserInst({ container, embedding, clickHandler, height, width });
      });
    } else if (inst && !container) {
      inst.destroy();
      inst = null;
    }
  });

  $effect(() => {
    if (inst && height > 0 && width > 0) {
      inst.resize(width, height);
    }
  });
</script>

<svelte:window bind:innerHeight={windowHeight} bind:innerWidth={windowWidth} />
<div class="container" bind:this={container}></div>

<style lang="css">
  .container {
    border: 1px solid #ccc;
    background: #000;
  }
</style>
