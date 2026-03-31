import { Pipe, PipeTransform } from '@angular/core';

@Pipe({ name: 'relativeTime' })
export class RelativeTimePipe implements PipeTransform {
  transform(value: string | Date): string {
    const date = value instanceof Date ? value : new Date(value);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMin < 1) return "a l'instant";
    if (diffMin < 60) return `il y a ${diffMin} min`;
    if (diffHours < 24) return `il y a ${diffHours} h`;
    if (diffDays < 2) return 'hier';
    if (diffDays < 7) return `il y a ${diffDays} j`;

    const sameYear = date.getFullYear() === now.getFullYear();
    if (sameYear) {
      return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    }
    return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  }
}
