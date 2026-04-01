import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () =>
      import('./components/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: '',
    loadComponent: () =>
      import('./components/layout/layout.component').then((m) => m.LayoutComponent),
    children: [
      {
        path: '',
        redirectTo: 'inbox',
        pathMatch: 'full',
      },
      {
        path: 'email/:folder/:uid',
        loadComponent: () =>
          import('./components/email-detail/email-detail.component').then(
            (m) => m.EmailDetailComponent
          ),
      },
      {
        path: 'folder/:folder',
        loadComponent: () =>
          import('./components/email-list/email-list.component').then(
            (m) => m.EmailListComponent
          ),
      },
      {
        path: ':label',
        loadComponent: () =>
          import('./components/email-list/email-list.component').then(
            (m) => m.EmailListComponent
          ),
      },
    ],
  },
];
