import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './assets/tailwind.css';
import { tooltip } from './directives/tooltip'


createApp(App)
.use(createPinia())
.use(router)
.directive('tooltip', tooltip)
.mount('#app')