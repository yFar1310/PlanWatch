// web/src/router/index.ts
import { createRouter, createWebHistory } from 'vue-router';

import Dashboard from '../pages/Dashboard.vue';
import PlansList from '../pages/PlansList.vue';
import PlansNew from '../pages/PlansNew.vue';
import PlansEdit from '../pages/PlansEdit.vue';
import Login from '../pages/Login.vue';
import ActivityLog from '../pages/ActivityLog.vue';
import Signup from '../pages/Signup.vue';
import Profile from '../pages/Profile.vue';

const routes = [
  {
    path: '/login',
    name: 'login',
    component: Login,
    meta: { public: true },
  },
  { path: '/signup', name: 'signup', component: Signup },
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
  {
    path: '/profile',
    name: 'profile',
    component: Profile,
    meta: { requiresAuth: true },
  },
  // 🔥 supporte les vieux liens /plans/:id/edit → redirige vers /plans/:id
  {
    path: '/plans/:id/edit',
    redirect: (to) => ({ name: 'plans-edit', params: { id: to.params.id } }),
  },
  { path: '/activity', name: 'activity', component: ActivityLog },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach((to, from, next) => {
  const token = localStorage.getItem('pw.token');
  const isAuthPage = to.name === 'login' || to.name === 'signup';

  // 1) Page protégée, pas de token → login
  if (to.meta.requiresAuth && !token) {
    return next({ name: 'login', query: { redirect: to.fullPath } });
  }

  // 2) Déjà connecté → pas la peine d’aller sur login / signup
  if (isAuthPage && token) {
    return next({ name: 'dashboard' });
  }

  // 3) Sinon OK
  next();
});

export default router;
