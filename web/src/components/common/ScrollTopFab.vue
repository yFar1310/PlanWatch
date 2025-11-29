<template>
    <transition name="fab">
      <div v-show="visible" class="fixed z-[70]" :style="posStyle">
        <button
          class="group scrolltop relative isolate overflow-hidden rounded-full
                 grid place-items-center leading-none
                 border border-slate-200/70 dark:border-white/10
                 bg-white/80 dark:bg-slate-900/70 backdrop-blur-xl
                 text-slate-700 dark:text-slate-100
                 shadow-[0_22px_60px_-24px_rgba(2,6,23,.55)]
                 transition-transform duration-200 ease-out"
          :style="{ width: fab+'px', height: fab+'px' }"
          :aria-label="ariaLabel"
          @click="toTop"
        >
          <svg class="ring pointer-events-none" :viewBox="`0 0 ${vb} ${vb}`" aria-hidden="true">
            <circle class="track" :cx="vb/2" :cy="vb/2" :r="r"/>
            <circle
              class="prog"
              :cx="vb/2"
              :cy="vb/2"
              :r="r"
              :style="{ strokeDasharray: C, strokeDashoffset: dashOffset }"
            />
          </svg>
  
          <ChevronUp class="chev pointer-events-none" :size="28" :stroke-width="2" aria-hidden="true" />
        </button>
  
        <span class="label">Back to top</span>
      </div>
    </transition>
  </template>
  
  <script setup lang="ts">
  import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
  import { ChevronUp } from 'lucide-vue-next';
  
  const props = withDefaults(defineProps<{
    showAt?: number
    size?: 'md'|'lg'|'xl'
    bottom?: number
    right?: number
    ariaLabel?: string
  }>(), {
    showAt: 220,
    size: 'xl',
    bottom: 28,
    right: 28,
    ariaLabel: 'Back to top'
  });
  
  const fab = computed(() => props.size === 'xl' ? 72 : props.size === 'lg' ? 64 : 56);
  const vb = 64;
  const r = 26;
  const C = 2 * Math.PI * r;
  
  const visible = ref(false);
  const progress = ref(0);
  
  const posStyle = computed(() => ({ bottom: `${props.bottom}px`, right: `${props.right}px` }));
  const dashOffset = computed(() => `${C * (1 - progress.value)}`);
  
  function onScroll() {
    const doc = document.documentElement;
    const y = window.scrollY || doc.scrollTop || 0;
    const h = doc.scrollHeight - doc.clientHeight;
  
    visible.value = y > props.showAt;
  
    if (h <= 0) {
      progress.value = 0;
      return;
    }
  
    const denom = Math.max(1, h - props.showAt);
    const pVisible = y <= props.showAt ? 0 : (y - props.showAt) / denom;
  
    progress.value = Math.min(1, Math.max(0, pVisible));
  }
  
  function toTop() {
    try {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      window.scrollTo(0, 0);
    }
  }
  
  onMounted(() => {
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  });
  onBeforeUnmount(() => window.removeEventListener('scroll', onScroll));
  </script>
  
  <style scoped>
  /* ton CSS inchangé */
  .scrolltop{ line-height:0; -webkit-appearance:none; appearance:none; outline:0!important; -webkit-tap-highlight-color:transparent; }
  .scrolltop:focus, .scrolltop:focus-visible{
    outline:0!important;
    box-shadow: 0 0 0 4px rgba(148,163,184,.28), 0 22px 60px -24px rgba(2,6,23,.55);
  }
  .ring{ position:absolute; inset:0; z-index:0; }
  .track{ fill:none; stroke:rgba(148,163,184,.28); stroke-width:4; }
  .dark .track{ stroke:rgba(148,163,184,.22); }
  .prog{
    fill:none; stroke:currentColor; stroke-width:4; stroke-linecap:round;
    transform: rotate(-90deg); transform-origin:50% 50%;
    transition: stroke-dashoffset .2s ease; opacity:.9;
  }
  .chev{ display:block; position:relative; z-index:1; transition: transform .18s ease; }
  .scrolltop:hover .chev{ transform: translateY(-2px); }
  .label{ position:absolute; right:calc(100% + 10px); top:50%; transform:translateY(-50%) translateX(4px);
    white-space:nowrap; padding:7px 10px; font-size:12px; line-height:1; border-radius:999px;
    color:#0f172a; background:#fff; border:1px solid rgba(15,23,42,.08); opacity:0;
    transition:opacity .18s, transform .18s; box-shadow:0 10px 30px rgba(2,6,23,.1); pointer-events:none; }
  .dark .label{ color:#e5e7eb; background:rgba(2,6,23,.9); border-color:rgba(255,255,255,.08); }
  @media (hover:hover){ .scrolltop:hover + .label{ opacity:1; transform:translateY(-50%) translateX(0); } }
  .scrolltop:focus-visible + .label{ opacity:1; transform:translateY(-50%) translateX(0); }
  .fab-enter-from, .fab-leave-to{ opacity:0; transform:translateY(10px) scale(.96); }
  .fab-enter-active, .fab-leave-active{ transition:opacity .22s ease, transform .28s cubic-bezier(.16,1,.3,1); }
  @media (prefers-reduced-motion: reduce){
    .fab-enter-active, .fab-leave-active, .scrolltop, .chev, .label { transition:none !important; }
  }
  button.scrolltop::-moz-focus-inner{ border:0; }
  </style>
  