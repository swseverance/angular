/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import {AnimateTimings, AnimationMetadata, sequence, ɵStyleData} from '@angular/animations';

export const ONE_SECOND = 1000;

export const ENTER_CLASSNAME = 'ng-enter';
export const LEAVE_CLASSNAME = 'ng-leave';
export const ENTER_SELECTOR = '.ng-enter';
export const LEAVE_SELECTOR = '.ng-leave';
export const NG_TRIGGER_CLASSNAME = 'ng-trigger';
export const NG_TRIGGER_SELECTOR = '.ng-trigger';
export const NG_ANIMATING_CLASSNAME = 'ng-animating';
export const NG_ANIMATING_SELECTOR = '.ng-animating';

export function resolveTimingValue(value: string | number) {
  if (typeof value == 'number') return value;

  const matches = (value as string).match(/^(-?[\.\d]+)(m?s)/);
  if (!matches || matches.length < 2) return 0;

  return _convertTimeValueToMS(parseFloat(matches[1]), matches[2]);
}

function _convertTimeValueToMS(value: number, unit: string): number {
  switch (unit) {
    case 's':
      return value * ONE_SECOND;
    default:  // ms or something else
      return value;
  }
}

export function resolveTiming(
    timings: string | number | AnimateTimings, errors: any[], allowNegativeValues?: boolean) {
  return timings.hasOwnProperty('duration') ?
      <AnimateTimings>timings :
      parseTimeExpression(<string|number>timings, errors, allowNegativeValues);
}

function parseTimeExpression(
    exp: string | number, errors: string[], allowNegativeValues?: boolean): AnimateTimings {
  const regex = /^(-?[\.\d]+)(m?s)(?:\s+(-?[\.\d]+)(m?s))?(?:\s+([-a-z]+(?:\(.+?\))?))?$/i;
  let duration: number;
  let delay: number = 0;
  let easing: string = '';
  if (typeof exp === 'string') {
    const matches = exp.match(regex);
    if (matches === null) {
      errors.push(`The provided timing value "${exp}" is invalid.`);
      return {duration: 0, delay: 0, easing: ''};
    }

    duration = _convertTimeValueToMS(parseFloat(matches[1]), matches[2]);

    const delayMatch = matches[3];
    if (delayMatch != null) {
      delay = _convertTimeValueToMS(Math.floor(parseFloat(delayMatch)), matches[4]);
    }

    const easingVal = matches[5];
    if (easingVal) {
      easing = easingVal;
    }
  } else {
    duration = <number>exp;
  }

  if (!allowNegativeValues) {
    let containsErrors = false;
    let startIndex = errors.length;
    if (duration < 0) {
      errors.push(`Duration values below 0 are not allowed for this animation step.`);
      containsErrors = true;
    }
    if (delay < 0) {
      errors.push(`Delay values below 0 are not allowed for this animation step.`);
      containsErrors = true;
    }
    if (containsErrors) {
      errors.splice(startIndex, 0, `The provided timing value "${exp}" is invalid.`);
    }
  }

  return {duration, delay, easing};
}

export function copyObj(
    obj: {[key: string]: any}, destination: {[key: string]: any} = {}): {[key: string]: any} {
  Object.keys(obj).forEach(prop => { destination[prop] = obj[prop]; });
  return destination;
}

export function normalizeStyles(styles: ɵStyleData | ɵStyleData[]): ɵStyleData {
  const normalizedStyles: ɵStyleData = {};
  if (Array.isArray(styles)) {
    styles.forEach(data => copyStyles(data, false, normalizedStyles));
  } else {
    copyStyles(styles, false, normalizedStyles);
  }
  return normalizedStyles;
}

export function copyStyles(
    styles: ɵStyleData, readPrototype: boolean, destination: ɵStyleData = {}): ɵStyleData {
  if (readPrototype) {
    // we make use of a for-in loop so that the
    // prototypically inherited properties are
    // revealed from the backFill map
    for (let prop in styles) {
      destination[prop] = styles[prop];
    }
  } else {
    copyObj(styles, destination);
  }
  return destination;
}

export function setStyles(element: any, styles: ɵStyleData) {
  if (element['style']) {
    Object.keys(styles).forEach(prop => element.style[prop] = styles[prop]);
  }
}

export function eraseStyles(element: any, styles: ɵStyleData) {
  if (element['style']) {
    Object.keys(styles).forEach(prop => {
      // IE requires '' instead of null
      // see https://github.com/angular/angular/issues/7916
      element.style[prop] = '';
    });
  }
}

export function normalizeAnimationEntry(steps: AnimationMetadata | AnimationMetadata[]):
    AnimationMetadata {
  if (Array.isArray(steps)) {
    if (steps.length == 1) return steps[0];
    return sequence(steps);
  }
  return steps as AnimationMetadata;
}

// this is a naive approach to search/replace
// TODO: check to see that transforms are not effected
const SIMPLE_STYLE_INTERPOLATION_REGEX = /\$\w+/g;
const ADVANCED_STYLE_INTERPOLATION_REGEX = /\$\{([-\w\s]+)\}/g;

export function validateStyleLocals(
    value: string | number, locals: {[name: string]: any}, errors: any[]) {
  if (typeof value == 'string') {
    matchAndValidate(SIMPLE_STYLE_INTERPOLATION_REGEX, 1, 0, value as string, locals, errors);
    matchAndValidate(ADVANCED_STYLE_INTERPOLATION_REGEX, 2, 1, value as string, locals, errors);
  }
}

function matchAndValidate(
    regex: RegExp, prefixLength: number, suffixLength: number, str: string,
    locals: {[name: string]: any}, errors: any[]) {
  const matches = str.toString().match(regex);
  if (matches) {
    matches.forEach(varName => {
      varName = '$' +
          varName.substring(prefixLength, varName.length - suffixLength);  // drop the $ or ${}
      if (!locals.hasOwnProperty(varName)) {
        errors.push(
            `Unable to resolve the local animation variable ${varName} in the given list of values`);
      }
    });
  }
}

export function interpolateLocals(
    value: string | number, locals: {[varName: string]: string | number}, errors: any[]): string|
    number {
  let original = value.toString();
  let str = original;
  str = matchAndReplace(SIMPLE_STYLE_INTERPOLATION_REGEX, 1, 0, str, locals, errors);
  str = matchAndReplace(ADVANCED_STYLE_INTERPOLATION_REGEX, 2, 1, str, locals, errors);

  // we do this to assert that numeric values stay as they are
  return str == original ? value : str;
}

function matchAndReplace(
    regex: RegExp, prefixLength: number, suffixLength: number, str: string,
    locals: {[varName: string]: string | number}, errors: any[]) {
  return str.replace(regex, exp => {
    const varName =
        '$' + exp.substring(prefixLength, exp.length - suffixLength);  // drop the $ or ${}
    let localVal = locals[varName];
    // this means that the value was never overidden by the data passed in by the user
    if (!locals.hasOwnProperty(varName)) {
      errors.push(`Please provide a value for the animation variable ${exp}`);
      localVal = '';
    }
    return localVal.toString();
  });
}

export function iteratorToArray(iterator: any): any[] {
  const arr: any[] = [];
  let item = iterator.next();
  while (!item.done) {
    arr.push(item.value);
    item = iterator.next();
  }
  return arr;
}
