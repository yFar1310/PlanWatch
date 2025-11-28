// web/src/router/index.ts
import { createRouter, createWebHistory } from 'vue-router';

import Dashboard from '../pages/Dashboard.vue';
import PlansList from '../pages/PlansList.vue';
import PlansNew from '../pages/PlansNew.vue';
import PlansEdit from '../pages/PlansEdit.vue';
import Login from '../pages/Login.vue';

const routes = [
  {
    path: '/login',
    name: 'login',
    component: Login,
    meta: { public: true },
  },
  {
    path: '/',
    name: 'dashboard',
    component: Dashboard,
    meta: { requiresAuth: true },
  },
  {
    path: '/plans',
    name: 'plans',
    component: PlansList,
    meta: { requiresAuth: true },
  },
  {
    path: '/plans/new',
    name: 'plans-new',
    component: PlansNew,
    meta: { requiresAuth: true },
  },
  {
    path: '/plans/:id',
    name: 'plans-edit',
    component: PlansEdit,
    meta: { requiresAuth: true },
  },
  // 🔥 supporte les vieux liens /plans/:id/edit → redirige vers /plans/:id
  {
    path: '/plans/:id/edit',
    redirect: (to) => ({ name: 'plans-edit', params: { id: to.params.id } }),
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

// Guard auth identique à avant
router.beforeEach((to, from, next) => {
  const token = localStorage.getItem('pw.token');

  if (to.meta.requiresAuth && !token) {
    return next({ name: 'login', query: { redirect: to.fullPath } });
  }

  if (to.name === 'login' && token) {
    return next({ name: 'dashboard' });
  }

  next();
});

export default router;
