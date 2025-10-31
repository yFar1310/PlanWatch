import { createRouter, createWebHistory } from 'vue-router'


const Dashboard = () => import('../pages/Dashboard.vue')
const PlansList = () => import('../pages/PlansList.vue')
const PlansNew = () => import('../pages/PlansNew.vue')


const router = createRouter({
history: createWebHistory(),
routes: [
{ path: '/', name: 'dashboard', component: Dashboard },
{ path: '/plans', name: 'plans', component: PlansList },
{ path: '/plans/new', name: 'plans-new', component: PlansNew },
{ path: '/plans/:id/edit', name: 'plan-edit', component: () => import('../pages/PlansEdit.vue') },
],
scrollBehavior() { return { top: 0 } },
})


export default router