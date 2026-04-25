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
  private startY = 0;
  private currentX = 0;
  private currentY = 0;
  private swiping = false;
  private axisLocked: 'horizontal' | 'vertical' | null = null;

  private readonly threshold = 96;
  private readonly horizontalStartThreshold = 18;
  private readonly verticalScrollThreshold = 8;
  private readonly axisRatio = 1.35;

  onTouchStart(event: TouchEvent): void {
    this.startX = event.touches[0].clientX;
    this.startY = event.touches[0].clientY;
    this.currentX = this.startX;
    this.currentY = this.startY;
    this.swiping = true;
    this.axisLocked = null;
  }

  onTouchMove(event: TouchEvent): void {
    if (!this.swiping) return;
    this.currentX = event.touches[0].clientX;
    this.currentY = event.touches[0].clientY;
    const diff = this.currentX - this.startX;
    const diffY = this.currentY - this.startY;
    const absX = Math.abs(diff);
    const absY = Math.abs(diffY);

    if (!this.axisLocked) {
      if (absY > this.verticalScrollThreshold && absY > absX) {
        this.cancelSwipe();
        return;
      }

      if (absX < this.horizontalStartThreshold || absX < absY * this.axisRatio) {
        return;
      }

      this.axisLocked = 'horizontal';
    }

    if (this.axisLocked !== 'horizontal') return;

    const el = this.el.nativeElement as HTMLElement;
    const clamped = Math.max(-120, Math.min(120, diff));
    el.style.transform = `translateX(${clamped}px)`;
    el.style.transition = 'none';
    this.swipeProgress.emit({ offset: clamped });
  }

  onTouchEnd(): void {
    if (!this.swiping) return;
    const isHorizontalSwipe = this.axisLocked === 'horizontal';
    this.swiping = false;
    this.axisLocked = null;

    const diff = this.currentX - this.startX;
    const el = this.el.nativeElement as HTMLElement;
    el.style.transform = '';
    el.style.transition = 'transform 0.2s ease';
    this.swipeReset.emit();

    if (!isHorizontalSwipe) return;

    if (diff > this.threshold) {
      this.swipeRight.emit();
    } else if (diff < -this.threshold) {
      this.swipeLeft.emit();
    }
  }

  private cancelSwipe(): void {
    this.swiping = false;
    this.axisLocked = 'vertical';
    const el = this.el.nativeElement as HTMLElement;
    el.style.transform = '';
    el.style.transition = 'transform 0.2s ease';
    this.swipeReset.emit();
  }
}
