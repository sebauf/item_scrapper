// Routes d'Auth.js : /api/auth/signin, /api/auth/callback/google, etc.
// L'URL de rappel à déclarer dans la console Google est
// <URL publique>/api/auth/callback/google.
import { handlers } from '@/auth';

export const { GET, POST } = handlers;
