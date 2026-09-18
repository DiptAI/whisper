import { createRouter, createWebHistory } from 'vue-router';
import { session } from './session';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: () => import('./views/HomeView.vue'), meta: { auth: true, profile: true } },
    { path: '/login', name: 'login', component: () => import('./views/LoginView.vue') },
    { path: '/r/:code', name: 'resume', component: () => import('./views/ResumeView.vue') },
    { path: '/profile', name: 'profile', component: () => import('./views/ProfileView.vue'), meta: { auth: true } },
    { path: '/task/audio/:id', name: 'audio-task', component: () => import('./views/AudioTaskView.vue'), meta: { auth: true, profile: true } },
    { path: '/task/text/:id', name: 'text-task', component: () => import('./views/TextTaskView.vue'), meta: { auth: true, profile: true } },
    { path: '/admin', name: 'admin', component: () => import('./views/AdminView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

router.beforeEach(async (to) => {
  if (!to.meta.auth) return true;
  await session.ensureLoaded();
  if (!session.participant.value) return { name: 'login', query: { next: to.fullPath } };
  if (to.meta.profile && !session.participant.value.profile_complete) return { name: 'profile' };
  return true;
});
