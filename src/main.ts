import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app';
import { installDomInlineHandlerGuard } from './app/utils/dom-inline-handler-guard';

installDomInlineHandlerGuard();

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));
