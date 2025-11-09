import { createRouter, createWebHistory } from 'vue-router';
import HomePage from './pages/HomePage.vue';
import AdminDashboard from './pages/AdminDashboard.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomePage },
    { path: '/admin', name: 'admin', component: AdminDashboard }
  ],
  scrollBehavior() {
    return { top: 0 };
  }
});

