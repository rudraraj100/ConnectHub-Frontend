import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'login',
    pathMatch: 'full'
  },
  {
    path: 'login',
    loadComponent: () =>
      import('./auth/login/login.component').then(m => m.LoginComponent),
    title: 'Sign In — ConnectHub'
  },
  {
    path: 'register',
    loadComponent: () =>
      import('./auth/register/register.component').then(m => m.RegisterComponent),
    title: 'Create Account — ConnectHub'
  },
  {
    path: 'dashboard',
    redirectTo: 'chat',
    pathMatch: 'full'
  },
  {
    path: 'chat',
    loadComponent: () =>
      import('./chat/chat.component').then(m => m.ChatComponent),
    title: 'Chat — ConnectHub'
  },
  {
    path: 'admin',
    loadComponent: () =>
      import('./admin/admin.component').then(m => m.AdminComponent),
    title: 'Admin — ConnectHub'
  },
  {
    path: 'oauth2/callback',
    loadComponent: () =>
      import('./auth/oauth2-callback/oauth2-callback.component')
        .then(m => m.OAuth2CallbackComponent),
    title: 'Signing in… — ConnectHub'
  },
  {
    path: 'reset-password',
    loadComponent: () =>
      import('./auth/reset-password/reset-password.component')
        .then(m => m.ResetPasswordComponent),
    title: 'Reset Password — ConnectHub'
  }
];
