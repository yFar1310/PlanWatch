import { createRouter, createWebHistory } from 'vue-router'

import Dashboard from '../pages/Dashboard.vue'
import PlansList from '../pages/PlansList.vue'
import PlansNew from '../pages/PlansNew.vue'
import PlansEdit from '../pages/PlansEdit.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'dashboard', component: Dashboard },
    { path: '/plans', name: 'plans', component: PlansList },
    { path: '/plans/new', name: 'plans-new', component: PlansNew },
    { path: '/plans/:id/edit', name: 'plan-edit', component: PlansEdit },
  ],
  scrollBehavior() {
    return { top: 0 }
  },
})

export default router
