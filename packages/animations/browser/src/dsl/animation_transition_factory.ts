/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import {ɵStyleData} from '@angular/animations';

import {getOrSetAsInMap} from '../render/shared';
import {iteratorToArray} from '../util';

import {TransitionAst} from './animation_ast';
import {buildAnimationTimelines} from './animation_timeline_builder';
import {TransitionMatcherFn} from './animation_transition_expr';
import {AnimationTransitionInstruction, createTransitionInstruction} from './animation_transition_instruction';
import {ElementInstructionMap} from './element_instruction_map';

export class AnimationTransitionFactory {
  constructor(
      private _triggerName: string, public ast: TransitionAst,
      private _stateStyles: {[stateName: string]: ɵStyleData}) {}

  match(currentState: any, nextState: any): boolean {
    return oneOrMoreTransitionsMatch(this.ast.matchers, currentState, nextState);
  }

  build(
      element: any, currentState: any, nextState: any,
      locals?: {[varName: string]: string | number},
      subInstructions?: ElementInstructionMap): AnimationTransitionInstruction|undefined {
    let animationLocals: {[varName: string]: string | number} = {};
    const transitionLocals = this.ast.locals;
    if (transitionLocals) {
      animationLocals = (locals || {}) as{[varName: string]: string | number};
      Object.keys(this.ast.locals).forEach(prop => {
        if (!animationLocals.hasOwnProperty(prop)) {
          animationLocals[prop] = transitionLocals[prop];
        }
      });
    }

    const backupStateStyles = this._stateStyles['*'] || {};
    const currentStateStyles = this._stateStyles[currentState] || backupStateStyles;
    const nextStateStyles = this._stateStyles[nextState] || backupStateStyles;

    const errors: any[] = [];
    const timelines = buildAnimationTimelines(
        element, this.ast.animation, currentStateStyles, nextStateStyles, animationLocals,
        subInstructions, errors);

    if (errors.length) {
      const errorMessage = `animation building failed:\n${errors.join("\n")}`;
      throw new Error(errorMessage);
    }

    const preStyleMap = new Map<any, {[prop: string]: boolean}>();
    const postStyleMap = new Map<any, {[prop: string]: boolean}>();
    const queriedElements = new Set<any>();
    timelines.forEach(tl => {
      const elm = tl.element;
      const preProps = getOrSetAsInMap(preStyleMap, elm, {});
      tl.preStyleProps.forEach(prop => preProps[prop] = true);

      const postProps = getOrSetAsInMap(postStyleMap, elm, {});
      tl.postStyleProps.forEach(prop => postProps[prop] = true);

      if (elm !== element) {
        queriedElements.add(elm);
      }
    });

    const queriedElementsList = iteratorToArray(queriedElements.values());
    return createTransitionInstruction(
        element, this._triggerName, currentState, nextState, nextState === 'void',
        currentStateStyles, nextStateStyles, timelines, queriedElementsList, preStyleMap,
        postStyleMap);
  }
}

function oneOrMoreTransitionsMatch(
    matchFns: TransitionMatcherFn[], currentState: any, nextState: any): boolean {
  return matchFns.some(fn => fn(currentState, nextState));
}
