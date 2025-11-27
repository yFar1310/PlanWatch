import type { Directive } from 'vue'

export const tooltip: Directive<HTMLElement, string> = {
  mounted(el, binding) {
    if (binding.value) {
      el.setAttribute('title', String(binding.value))
    }
  },
  updated(el, binding) {
    if (binding.value) {
      el.setAttribute('title', String(binding.value))
    } else {
      el.removeAttribute('title')
    }
  },
}