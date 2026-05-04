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

    if (isHorizontalSwipe && diff > this.threshold) {
      this.animateOut(el, 'right');
      return;
    }
    if (isHorizontalSwipe && diff < -this.threshold) {
      this.animateOut(el, 'left');
      return;
    }

    el.style.transform = '';
    el.style.transition = 'transform 0.2s ease';
    this.swipeReset.emit();
  }

  /**
   * Two-phase swipe-accept animation:
   *   1. Slide the row off-screen (~180 ms). The colored "action" background
   *      that lives behind the row is fully revealed, so visually the row
   *      "becomes" the action color.
   *   2. Collapse the wrapping shell's height to 0 (~180 ms). This makes the
   *      row tile look like it's being absorbed, instead of leaving a hole
   *      in the list when the action removes it.
   *   3. Fire the swipe action and reset all inline styles in case the row
   *      survives (toggleStar / toggleRead don't remove it).
   */
  private animateOut(el: HTMLElement, direction: 'left' | 'right'): void {
    const shell = (el.parentElement as HTMLElement | null) ?? el;
    const distance = (el.offsetWidth || window.innerWidth) * 1.1;
    const targetX = direction === 'right' ? distance : -distance;

    // Keep the swipe-progress indicator pinned at full opacity for the rest
    // of the animation.
    this.swipeProgress.emit({ offset: direction === 'right' ? 120 : -120 });

    // Phase 1: slide the row off so only the action-colored background remains
    // visible inside the shell.
    el.style.transition = 'transform 0.18s ease-out';
    el.style.transform = `translateX(${targetX}px)`;

    let finished = false;
    const finalize = () => {
      if (finished) return;
      finished = true;
      if (direction === 'right') this.swipeRight.emit();
      else this.swipeLeft.emit();
      // Reset all inline styles so a surviving row (e.g. toggleStar) reappears
      // in place instead of staying collapsed / off-screen.
      el.style.transition = 'none';
      el.style.transform = '';
      el.style.opacity = '';
      shell.style.transition = '';
      shell.style.height = '';
      shell.style.minHeight = '';
      shell.style.marginTop = '';
      shell.style.marginBottom = '';
      shell.style.paddingTop = '';
      shell.style.paddingBottom = '';
      shell.style.overflow = '';
      shell.style.opacity = '';
      this.swipeReset.emit();
    };

    setTimeout(() => {
      if (finished) return;
      // Phase 2: collapse the shell height. Pin the current height first so
      // the browser can transition from a known value to 0.
      const currentHeight = shell.offsetHeight;
      shell.style.height = `${currentHeight}px`;
      shell.style.minHeight = '0';
      shell.style.overflow = 'hidden';
      // Force layout flush so the next height write actually animates.
      void shell.offsetHeight;
      shell.style.transition = 'height 0.18s ease-in, margin 0.18s ease-in, padding 0.18s ease-in, opacity 0.18s ease-in';
      shell.style.height = '0px';
      shell.style.marginTop = '0';
      shell.style.marginBottom = '0';
      shell.style.paddingTop = '0';
      shell.style.paddingBottom = '0';
      shell.style.opacity = '0';

      // After the collapse animation, fire the action.
      setTimeout(finalize, 200);
    }, 180);
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
