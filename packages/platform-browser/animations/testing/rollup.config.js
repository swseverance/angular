/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

export default {
  entry:
      '../../../../dist/packages-dist/platform-browser/@angular/platform-browser/animations/testing.es5.js',
  dest:
      '../../../../dist/packages-dist/platform-browser/bundles/platform-browser-animations-testing.umd.js',
  format: 'umd',
  exports: 'named',
  moduleName: 'ng.platformBrowser.animations.testing',
  globals: {
    '@angular/core': 'ng.core',
    '@angular/common': 'ng.common',
    '@angular/platform-browser': 'ng.platformBrowser',
    '@angular/platform-browser/testing': 'ng.platformBrowser.testing',
    '@angular/animations': 'ng.animations',
    '@angular/animations/browser': 'ng.animations.browser',
    '@angular/animations/browser/testing': 'ng.animations.browser.testing'
  }
};
