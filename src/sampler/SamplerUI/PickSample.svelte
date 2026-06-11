<script lang="ts">
  import type { SampleDescriptor } from 'src/sampleLibrary';
  import { selectSample } from 'src/sampleLibrary/SampleLibraryUI/SelectSample';

  interface Props {
    onSamplePicked: (desc: SampleDescriptor) => void;
  }

  let { onSamplePicked }: Props = $props();

  let isPicking = $state(false);
  const pickSample = async () => {
    isPicking = true;
    try {
      onSamplePicked(await selectSample());
    } finally {
      isPicking = false;
    }
  };
</script>

<div class="root">
  <button style="width: 140px" disabled={isPicking} onclick={pickSample}>Pick Sample</button>
</div>

<style lang="css">
  .root {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding-top: 80px;
  }
</style>
