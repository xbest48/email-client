import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { SettingsService } from '../../services/settings.service';
import { ThemeService } from '../../services/theme.service';

/**
 * Kyma logo rendered as an inline SVG, using the faithful path data from
 * public/kyma-logo-faithful.svg. Fill colors are bound via [attr.fill] so
 * they sidestep every CSS scoping / cascade quirk we hit with classes and
 * CSS variables on SVG children.
 *
 * The letters ("primary") follow the user's accent color from settings — the
 * same color that themes the rest of the UI chrome. The feather keeps its
 * own gold "accent" color, which can be overridden via the `accent` input
 * (otherwise it defaults to the site theme gold).
 */
@Component({
  selector: 'app-kyma-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 735 275" role="img" aria-label="KYMA Mail logo">
      <path fill-rule="evenodd"
            [attr.fill]="resolvedAccent()"
            d="M 215 8 L 214 7 L 206 8 L 182 16 L 179 18 L 174 19 L 172 21 L 160 25 L 141 35 L 130 49 L 125 59 L 123 61 L 117 75 L 116 74 L 116 70 L 117 69 L 117 64 L 118 63 L 121 48 L 114 52 L 101 63 L 86 81 L 76 100 L 73 109 L 74 110 L 73 112 L 73 126 L 74 129 L 149 62 L 155 58 L 179 37 L 181 38 L 104 113 L 104 114 L 81 136 L 81 138 L 90 143 L 92 143 L 94 145 L 95 144 L 111 143 L 115 141 L 125 139 L 147 128 L 167 112 L 168 110 L 159 111 L 158 112 L 152 112 L 151 113 L 127 113 L 126 112 L 135 109 L 139 109 L 140 108 L 151 106 L 165 100 L 167 100 L 183 91 L 189 85 L 198 68 L 174 76 L 170 76 L 169 77 L 164 77 L 163 76 L 187 64 L 196 58 L 206 49 L 209 42 L 210 34 L 212 29 L 213 18 L 214 17 L 214 10 Z"/>
      <path fill-rule="evenodd"
            [attr.fill]="primary()"
            d="M 684 207 L 681 210 L 681 216 L 684 220 L 690 221 L 693 217 L 693 213 L 690 208 Z M 727 194 L 723 191 L 719 192 L 708 205 L 699 219 L 692 233 L 691 238 L 688 244 L 688 247 L 682 257 L 674 265 L 671 265 L 670 264 L 670 258 L 683 232 L 683 223 L 681 220 L 678 220 L 673 226 L 662 247 L 661 252 L 656 260 L 652 264 L 648 266 L 646 264 L 646 260 L 649 254 L 649 252 L 661 232 L 662 224 L 660 219 L 658 218 L 652 223 L 648 219 L 640 219 L 637 220 L 628 226 L 622 232 L 616 240 L 612 248 L 612 251 L 611 252 L 611 263 L 612 265 L 618 270 L 625 270 L 630 268 L 636 263 L 637 266 L 640 269 L 646 271 L 653 270 L 660 265 L 661 267 L 665 270 L 675 270 L 680 268 L 686 263 L 690 268 L 694 270 L 702 270 L 711 266 L 719 258 L 721 254 L 721 247 L 720 246 L 717 246 L 711 256 L 701 265 L 698 265 L 696 263 L 696 255 L 699 245 L 714 232 L 723 220 L 729 206 L 729 198 Z M 645 226 L 647 228 L 646 233 L 639 248 L 633 257 L 626 264 L 623 265 L 622 264 L 622 257 L 627 245 L 632 238 Z M 721 206 L 722 208 L 717 218 L 710 227 L 709 226 L 710 223 Z M 622 192 L 620 191 L 617 191 L 605 209 L 585 233 L 578 243 L 577 242 L 578 237 L 588 207 L 588 199 L 587 196 L 582 191 L 579 191 L 565 210 L 564 213 L 548 238 L 538 259 L 538 267 L 541 271 L 544 270 L 552 253 L 554 251 L 565 231 L 569 226 L 570 228 L 563 252 L 563 263 L 564 266 L 569 271 L 571 271 L 589 243 L 597 233 L 598 236 L 593 245 L 588 260 L 589 268 L 592 271 L 594 271 L 596 268 L 600 256 L 605 247 L 605 245 L 625 205 L 625 197 Z M 453 184 L 452 189 L 448 197 L 447 202 L 440 218 L 436 231 L 432 239 L 430 247 L 478 247 L 473 235 L 472 230 L 468 222 L 467 217 L 465 214 L 464 209 L 460 201 L 459 196 L 457 193 L 454 184 Z M 454 223 L 456 226 L 460 238 L 459 239 L 448 239 L 447 238 L 450 232 L 451 227 Z M 441 168 L 437 180 L 435 183 L 434 188 L 430 196 L 429 201 L 427 204 L 426 209 L 424 212 L 423 217 L 416 233 L 415 238 L 413 241 L 412 246 L 405 262 L 404 267 L 402 270 L 435 270 L 439 261 L 468 261 L 470 263 L 472 270 L 505 270 L 500 258 L 499 253 L 497 250 L 496 245 L 492 237 L 491 232 L 489 229 L 488 224 L 484 216 L 483 211 L 481 208 L 480 203 L 478 200 L 477 195 L 473 187 L 467 169 L 466 168 Z M 452 180 L 456 180 L 458 183 L 462 196 L 466 204 L 470 217 L 472 220 L 478 238 L 486 257 L 485 258 L 483 258 L 481 256 L 479 250 L 428 250 L 426 257 L 425 258 L 422 257 L 425 247 L 432 231 L 433 226 L 440 210 L 441 205 L 448 189 L 449 184 Z M 292 168 L 292 270 L 325 270 L 325 237 L 326 236 L 345 264 L 346 264 L 366 235 L 367 236 L 367 270 L 400 270 L 400 168 L 372 168 L 346 206 L 343 203 L 322 171 L 319 168 Z M 307 181 L 308 180 L 311 180 L 322 197 L 325 200 L 339 222 L 346 231 L 376 186 L 381 180 L 383 180 L 384 181 L 384 257 L 383 258 L 380 257 L 380 188 L 379 188 L 346 237 L 313 189 L 311 188 L 311 257 L 308 258 L 307 257 Z M 193 168 L 225 226 L 225 270 L 258 270 L 258 227 L 290 168 L 253 168 L 242 188 L 230 168 Z M 219 180 L 221 180 L 223 182 L 226 189 L 228 191 L 232 200 L 234 202 L 238 211 L 242 217 L 262 180 L 265 180 L 266 181 L 264 183 L 260 192 L 258 194 L 254 203 L 252 205 L 248 214 L 244 220 L 244 257 L 243 258 L 240 257 L 240 221 L 236 215 L 232 206 L 230 204 L 225 193 L 223 191 L 218 181 Z M 5 7 L 5 269 L 59 269 L 59 181 L 72 167 L 73 167 L 79 174 L 94 195 L 98 198 L 97 199 L 101 203 L 113 220 L 117 224 L 151 269 L 214 269 L 214 267 L 125 151 L 121 153 L 110 155 L 110 157 L 119 169 L 123 173 L 138 194 L 184 253 L 183 254 L 159 254 L 127 213 L 87 159 L 83 155 L 93 145 L 82 140 L 80 138 L 44 174 L 44 253 L 42 255 L 41 254 L 21 254 L 20 253 L 20 246 L 21 245 L 21 237 L 20 236 L 20 23 L 21 22 L 43 22 L 44 23 L 44 157 L 73 129 L 72 126 L 72 112 L 73 110 L 60 122 L 59 121 L 59 7 Z"/>
    </svg>
  `,
  styles: `
    :host {
      display: inline-block;
      line-height: 0;
    }

    svg {
      display: block;
      width: 100%;
      height: 100%;
    }
  `,
})
export class KymaLogoComponent {
  private readonly theme = inject(ThemeService);
  private readonly settingsService = inject(SettingsService);

  /**
   * Override the feather (accent) color. When omitted, the feather follows
   * the site theme gold. Pass any CSS color string (e.g. '#e3bf59').
   */
  readonly accent = input<string | null>(null);

  /**
   * The letters of the wordmark use the user-selected accent color from
   * settings — the same color that themes the rest of the UI.
   */
  readonly primary = computed(() => this.settingsService.settings().accentColor);

  private readonly themedAccent = computed(() => (this.theme.isDark() ? '#f4c84f' : '#e3bf59'));

  readonly resolvedAccent = computed(() => this.accent() ?? this.themedAccent());
}
