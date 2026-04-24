import { Directive, ElementRef, inject, output } from '@angular/core';

@Directive({
  selector: '[appSwipe]',
  host: {
    '(touchstart)': 'onTouchStart($event)',
    '(touchmove)': 'onTouchMove($event)',
    '(touchend)': 'onTouchEnd()',
  },
})
export class SwipeDirective {
  private readonly el = inject(ElementRef);

  readonly swipeLeft = output<void>();
  readonly swipeRight = output<void>();
  readonly swipeProgress = output<{ offset: number }>();
  readonly swipeReset = output<void>();

  private startX = 0;
  private currentX = 0;
  private swiping = false;

  private readonly threshold = 80;

  onTouchStart(event: TouchEvent): void {
    this.startX = event.touches[0].clientX;
    this.currentX = this.startX;
    this.swiping = true;
  }

  onTouchMove(event: TouchEvent): void {
    if (!this.swiping) return;
    this.currentX = event.touches[0].clientX;
    const diff = this.currentX - this.startX;
    const el = this.el.nativeElement as HTMLElement;
    const clamped = Math.max(-120, Math.min(120, diff));
    el.style.transform = `translateX(${clamped}px)`;
    el.style.transition = 'none';
    this.swipeProgress.emit({ offset: clamped });
  }

  onTouchEnd(): void {
    if (!this.swiping) return;
    this.swiping = false;

    const diff = this.currentX - this.startX;
    const el = this.el.nativeElement as HTMLElement;
    el.style.transform = '';
    el.style.transition = 'transform 0.2s ease';
    this.swipeReset.emit();

    if (diff > this.threshold) {
      this.swipeRight.emit();
    } else if (diff < -this.threshold) {
      this.swipeLeft.emit();
    }
  }
}
