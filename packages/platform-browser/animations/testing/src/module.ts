/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import {NgModule} from '@angular/core';
import {NoopAnimationsModule} from '@angular/platform-browser/animations';
import {BrowserTestingModule} from '@angular/platform-browser/testing';

import {PLATFORM_BROWSER_ANIMATIONS_TOKENS} from './providers';


/**
 * NgModule for testing.
 *
 * @experimental
 */
@NgModule({exports: [BrowserTestingModule], providers: [PLATFORM_BROWSER_ANIMATIONS_TOKENS]})
export class BrowserAnimationsTestingModule {
}

/**
 * NgModule for testing.
 *
 * @experimental
 */
@NgModule({
  imports: [BrowserTestingModule, NoopAnimationsModule],
  providers: [PLATFORM_BROWSER_ANIMATIONS_TOKENS]
})
export class NoopAnimationsTestingModule {
}
