/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import {ɵAnimationEngine as AnimationEngine} from '@angular/animations/browser';
import {Provider} from '@angular/core';
import {FLUSH_ANIMATIONS_FN} from '@angular/core/testing';

export function linkAnimationFlushFn(engine: AnimationEngine) {
  return () => engine.flush();
}

export const PLATFORM_BROWSER_ANIMATIONS_TOKENS: Provider[] = [
  {provide: FLUSH_ANIMATIONS_FN, useFactory: linkAnimationFlushFn, deps: [AnimationEngine]},
];
