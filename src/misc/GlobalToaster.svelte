<script lang="ts">
  import toast, { Toaster, type Renderable, type ToastOptions } from 'svelte-french-toast';
  import type { Writable } from 'svelte/store';

  export let curToast: Writable<{
    message: Renderable;
    options?: ToastOptions;
    variant?: 'success' | 'error';
  } | null>;
  $: if ($curToast) {
    const { message, options: rawOpts, variant } = $curToast;
    const opts: ToastOptions = {
      style: 'background: #222; border: 1px solid #aaa; color: #ececec',
      ...(rawOpts || []),
    };

    if (variant === 'success') {
      toast.success(message, opts);
    } else if (variant === 'error') {
      toast.error(message, opts);
    } else {
      toast(message, opts);
    }
  }
</script>

<Toaster />
