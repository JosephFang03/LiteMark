/* eslint-disable node/no-unsupported-features/es-syntax */
import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router.js';
import './style.css';

const apiBaseFromEnv = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

if (typeof window !== 'undefined') {
  (window as { __APP_API_BASE_URL__?: string }).__APP_API_BASE_URL__ = apiBaseFromEnv;
}
/* eslint-enable node/no-unsupported-features/es-syntax */

const app = createApp(App);
app.use(router);
app.mount('#app');

