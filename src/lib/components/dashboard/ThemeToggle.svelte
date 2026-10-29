<script lang="ts">
	import { onMount } from 'svelte';
	import Sun from '@lucide/svelte/icons/sun';
	import Moon from '@lucide/svelte/icons/moon';

	let mode = $state<'light' | 'dark'>('light');
	onMount(() => {
		mode = document.documentElement.dataset.mode === 'dark' ? 'dark' : 'light';
	});
	function toggle() {
		mode = mode === 'light' ? 'dark' : 'light';
		document.documentElement.dataset.mode = mode;
		try {
			localStorage.setItem('agenticefi-mode', mode);
		} catch {
			// The switch still works when browser storage is unavailable.
		}
	}
</script>

<button
	type="button"
	class="ml-auto btn size-10 shrink-0 preset-tonal-surface p-0"
	aria-label="Dark mode"
	aria-pressed={mode === 'dark'}
	title={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
	onclick={toggle}
>
	{#if mode === 'dark'}<Sun size={16} strokeWidth={2} aria-hidden="true" />{:else}<Moon
			size={16}
			strokeWidth={2}
			aria-hidden="true"
		/>{/if}
</button>
