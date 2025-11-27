import { createApp, ref } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './assets/tailwind.css'
import { tooltip } from './directives/tooltip'

const app = createApp(App)
const isNavigating = ref(false)

// make it available in the tree
app.provide('isNavigating', isNavigating)

router.beforeEach((to, from, next) => {
  isNavigating.value = true
  next()
})

router.afterEach(() => {
  // small delay for smoother feeling on quick pages
  setTimeout(() => {
    isNavigating.value = false
  }, 120)
})

app
  .use(createPinia())
  .use(router)
  .directive('tooltip', tooltip)
  .mount('#app')
