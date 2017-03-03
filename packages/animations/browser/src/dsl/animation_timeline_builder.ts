/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import {AUTO_STYLE, AnimateTimings, ɵPRE_STYLE as PRE_STYLE, ɵStyleData} from '@angular/animations';

import {copyObj, copyStyles, interpolateLocals, iteratorToArray, resolveTiming, resolveTimingValue} from '../util';

import {AnimateAst, AnimateChildAst, AnimateRefAst, Ast, AstVisitor, DynamicTimingAst, GroupAst, KeyframesAst, QueryAst, ReferenceAst, SequenceAst, StaggerAst, StateAst, StyleAst, TimingAst, TransitionAst, TriggerAst} from './animation_ast';
import {AnimationTimelineInstruction, createTimelineInstruction} from './animation_timeline_instruction';
import {ElementInstructionMap} from './element_instruction_map';



/*
 * The code within this file aims to generate web-animations-compatible keyframes from Angular's
 * animation DSL code.
 *
 * The code below will be converted from:
 *
 * ```
 * sequence([
 *   style({ opacity: 0 }),
 *   animate(1000, style({ opacity: 0 }))
 * ])
 * ```
 *
 * To:
 * ```
 * keyframes = [{ opacity: 0, offset: 0 }, { opacity: 1, offset: 1 }]
 * duration = 1000
 * delay = 0
 * easing = ''
 * ```
 *
 * For this operation to cover the combination of animation verbs (style, animate, group, etc...) a
 * combination of prototypical inheritance, AST traversal and merge-sort-like algorithms are used.
 *
 * [AST Traversal]
 * Each of the animation verbs, when executed, will return an string-map object representing what
 * type of action it is (style, animate, group, etc...) and the data associated with it. This means
 * that when functional composition mix of these functions is evaluated (like in the example above)
 * then it will end up producing a tree of objects representing the animation itself.
 *
 * When this animation object tree is processed by the visitor code below it will visit each of the
 * verb statements within the visitor. And during each visit it will build the context of the
 * animation keyframes by interacting with the `TimelineBuilder`.
 *
 * [TimelineBuilder]
 * This class is responsible for tracking the styles and building a series of keyframe objects for a
 * timeline between a start and end time. The builder starts off with an initial timeline and each
 * time the AST comes across a `group()`, `keyframes()` or a combination of the two wihtin a
 * `sequence()` then it will generate a sub timeline for each step as well as a new one after
 * they are complete.
 *
 * As the AST is traversed, the timing state on each of the timelines will be incremented. If a sub
 * timeline was created (based on one of the cases above) then the parent timeline will attempt to
 * merge the styles used within the sub timelines into itself (only with group() this will happen).
 * This happens with a merge operation (much like how the merge works in mergesort) and it will only
 * copy the most recently used styles from the sub timelines into the parent timeline. This ensures
 * that if the styles are used later on in another phase of the animation then they will be the most
 * up-to-date values.
 *
 * [How Missing Styles Are Updated]
 * Each timeline has a `backFill` property which is responsible for filling in new styles into
 * already processed keyframes if a new style shows up later within the animation sequence.
 *
 * ```
 * sequence([
 *   style({ width: 0 }),
 *   animate(1000, style({ width: 100 })),
 *   animate(1000, style({ width: 200 })),
 *   animate(1000, style({ width: 300 }))
 *   animate(1000, style({ width: 400, height: 400 })) // notice how `height` doesn't exist anywhere
 * else
 * ])
 * ```
 *
 * What is happening here is that the `height` value is added later in the sequence, but is missing
 * from all previous animation steps. Therefore when a keyframe is created it would also be missing
 * from all previous keyframes up until where it is first used. For the timeline keyframe generation
 * to properly fill in the style it will place the previous value (the value from the parent
 * timeline) or a default value of `*` into the backFill object. Given that each of the keyframe
 * styles are objects that prototypically inhert from the backFill object, this means that if a
 * value is added into the backFill then it will automatically propagate any missing values to all
 * keyframes. Therefore the missing `height` value will be properly filled into the already
 * processed keyframes.
 *
 * When a sub-timeline is created it will have its own backFill property. This is done so that
 * styles present within the sub-timeline do not accidentally seep into the previous/future timeline
 * keyframes
 *
 * (For prototypically-inherited contents to be detected a `for(i in obj)` loop must be used.)
 *
 * [Validation]
 * The code in this file is not responsible for validation. That functionality happens with within
 * the `AnimationValidatorVisitor` code.
 */
export function buildAnimationTimelines(
    rootElement: any, ast: Ast, startingStyles: ɵStyleData = {}, finalStyles: ɵStyleData = {},
    locals: {[name: string]: any}, subInstructions?: ElementInstructionMap,
    errors: any[] = []): AnimationTimelineInstruction[] {
  return new AnimationTimelineBuilderVisitor().buildKeyframes(
      rootElement, ast, startingStyles, finalStyles, locals, subInstructions, errors);
}

export declare type StyleAtTime = {
  time: number; value: string | number;
};

const DEFAULT_NOOP_PREVIOUS_NODE = <Ast>{};
export class AnimationTimelineContext {
  parentContext: AnimationTimelineContext|null = null;
  currentTimeline: TimelineBuilder;
  currentAnimateTimings: AnimateTimings|null = null;
  previousNode: Ast = DEFAULT_NOOP_PREVIOUS_NODE;
  subContextCount = 0;
  locals: {[name: string]: any} = {};
  currentQueryIndex: number = 0;
  currentQueryTotal: number = 0;
  currentStaggerTime: number = 0;

  constructor(
      public element: any, public subInstructions: ElementInstructionMap, public errors: any[],
      public timelines: TimelineBuilder[], initialTimeline?: TimelineBuilder) {
    this.currentTimeline = initialTimeline || new TimelineBuilder(element, 0);
    timelines.push(this.currentTimeline);
  }

  updateLocals(newLocals: {[name: string]: any}|null, skipIfExists?: boolean) {
    if (!newLocals) return;

    Object.keys(newLocals).forEach(name => {
      const value = newLocals[name];
      if (!skipIfExists || !newLocals.hasOwnProperty(name)) {
        this.locals[name] = value;
      }
    });

    if (newLocals.hasOwnProperty('duration')) {
      this.locals['duration'] = resolveTimingValue(newLocals['duration']);
    }

    if (newLocals.hasOwnProperty('delay')) {
      this.locals['delay'] = resolveTimingValue(newLocals['delay']);
    }
  }

  private _copyLocals() {
    const locals: {[name: string]: any} = {};
    if (this.locals) {
      Object.keys(this.locals).forEach(name => {
        if (name.charAt(0) == '$') {
          locals[name] = this.locals[name];
        }
      });
    }
    return locals;
  }

  createSubContext(locals: {[name: string]: any}|null = null, element?: any, newTime?: number):
      AnimationTimelineContext {
    const target = element || this.element;
    const context = new AnimationTimelineContext(
        target, this.subInstructions, this.errors, this.timelines,
        this.currentTimeline.fork(target, newTime || 0));
    context.previousNode = this.previousNode;
    context.currentAnimateTimings = this.currentAnimateTimings;

    context.locals = this._copyLocals();
    context.updateLocals(locals);

    context.currentQueryIndex = this.currentQueryIndex;
    context.currentQueryTotal = this.currentQueryTotal;
    context.parentContext = this;
    this.subContextCount++;
    return context;
  }

  transformIntoNewTimeline(newTime?: number) {
    this.previousNode = DEFAULT_NOOP_PREVIOUS_NODE;
    this.currentTimeline = this.currentTimeline.fork(this.element, newTime || 0);
    this.timelines.push(this.currentTimeline);
    return this.currentTimeline;
  }

  appendInstructionToTimeline(instruction: AnimationTimelineInstruction, timings: AnimateTimings):
      AnimateTimings {
    const updatedTimings: AnimateTimings = {
      duration: timings.duration != null ? timings.duration : instruction.duration,
      delay: this.currentTimeline.currentTime + (timings.delay != null ? timings.delay : 0) +
          instruction.delay,
      easing: timings.easing != null ? timings.easing : instruction.easing
    };
    const builder = new SubTimelineBuilder(
        instruction.element, instruction.keyframes, instruction.preStyleProps,
        instruction.postStyleProps, updatedTimings, instruction.stretchStartingKeyframe);
    this.timelines.push(builder);
    return updatedTimings;
  }

  incrementTime(time: number) {
    this.currentTimeline.forwardTime(this.currentTimeline.duration + time);
  }

  delayNextStep(delay: number) {
    // negative delays are not yet supported
    if (delay > 0) {
      this.currentTimeline.delayNextStep(delay);
    }
  }
}

export class AnimationTimelineBuilderVisitor implements AstVisitor {
  buildKeyframes(
      rootElement: any, ast: Ast, startingStyles: ɵStyleData, finalStyles: ɵStyleData,
      locals: {[name: string]: any}, subInstructions?: ElementInstructionMap,
      errors: any[] = []): AnimationTimelineInstruction[] {
    subInstructions = subInstructions || new ElementInstructionMap();
    const context = new AnimationTimelineContext(rootElement, subInstructions, errors, []);
    context.locals = locals || {};
    context.currentTimeline.setStyles([startingStyles], null, false, context.errors, locals);

    ast.visit(this, context);

    // this checks to see if an actual animation happened
    const timelines = context.timelines.filter(timeline => timeline.containsAnimation());
    if (timelines.length && Object.keys(finalStyles).length) {
      const tl = timelines[timelines.length - 1];
      if (!tl.allowOnlyTimelineStyles()) {
        tl.setStyles([finalStyles], null, false, context.errors, locals);
      }
    }

    return timelines.length ? timelines.map(timeline => timeline.buildKeyframes()) :
                              [createTimelineInstruction(rootElement, [], [], [], 0, 0, '', false)];
  }

  visitTrigger(ast: TriggerAst, context: AnimationTimelineContext): any {
    // these values are not visited in this AST
  }

  visitState(ast: StateAst, context: AnimationTimelineContext): any {
    // these values are not visited in this AST
  }

  visitTransition(ast: TransitionAst, context: AnimationTimelineContext): any {
    // these values are not visited in this AST
  }

  visitAnimateChild(ast: AnimateChildAst, context: AnimationTimelineContext): any {
    const elementInstructions = context.subInstructions.consume(context.element);
    if (elementInstructions) {
      const innerContext = context.createSubContext(ast.locals);
      const startTime = context.currentTimeline.currentTime;
      const endTime = this._visitSubInstructions(elementInstructions, innerContext);
      if (startTime != endTime) {
        // we do this on the upper context because we created a sub context for
        // the sub child animations
        context.transformIntoNewTimeline(endTime);
      }
    }
    context.previousNode = ast;
  }

  visitAnimateRef(ast: AnimateRefAst, context: AnimationTimelineContext): any {
    const innerContext = context.createSubContext(ast.locals);
    innerContext.transformIntoNewTimeline();
    this.visitReference(ast.animation, innerContext);
    context.transformIntoNewTimeline(innerContext.currentTimeline.currentTime);
    context.previousNode = ast;
  }

  private _visitSubInstructions(
      instructions: AnimationTimelineInstruction[], context: AnimationTimelineContext): number {
    const locals = context.locals || {};
    const startTime = context.currentTimeline.currentTime;
    let furthestTime = startTime;

    // this is a special-case for when a user wants to skip a sub
    // animation from being fired entirely.
    const duration = locals['duration'] as number;
    if (duration !== 0) {
      const timings: AnimateTimings = {duration, delay: locals['delay'], easing: locals['easing']};

      instructions.forEach(instruction => {
        const instructionTimings = context.appendInstructionToTimeline(instruction, timings);
        furthestTime =
            Math.max(furthestTime, instructionTimings.duration + instructionTimings.delay);
      });
    }

    return furthestTime;
  }

  visitReference(ast: ReferenceAst, context: AnimationTimelineContext) {
    context.updateLocals(ast.locals, true);
    ast.animation.visit(this, context);
    context.previousNode = ast;
  }

  visitSequence(ast: SequenceAst, context: AnimationTimelineContext) {
    const subContextCount = context.subContextCount;
    if (context.previousNode instanceof StyleAst) {
      context.currentTimeline.forwardFrame();
      context.currentTimeline.snapshotCurrentStyles();
      context.previousNode = DEFAULT_NOOP_PREVIOUS_NODE;
    }

    if (ast.locals) {
      context.createSubContext(ast.locals);
      context.transformIntoNewTimeline();

      if (ast.locals.hasOwnProperty('delay')) {
        context.delayNextStep(ast.locals['delay'] as number);
      }
    }

    ast.steps.forEach(s => s.visit(this, context));

    // this means that some animation function within the sequence
    // ended up creating a sub timeline (which means the current
    // timeline cannot overlap with the contents of the sequence)
    if (context.subContextCount > subContextCount) {
      context.transformIntoNewTimeline();
    }

    context.previousNode = ast;
  }

  visitGroup(ast: GroupAst, context: AnimationTimelineContext) {
    const innerTimelines: TimelineBuilder[] = [];
    let furthestTime = context.currentTimeline.currentTime;
    const hasDelay = ast.locals && ast.locals.hasOwnProperty('delay');

    ast.steps.forEach(s => {
      const innerContext = context.createSubContext(ast.locals);
      if (hasDelay) {
        innerContext.delayNextStep(innerContext.locals['delay'] as number);
      }

      s.visit(this, innerContext);
      furthestTime = Math.max(furthestTime, innerContext.currentTimeline.currentTime);
      innerTimelines.push(innerContext.currentTimeline);
    });

    // this operation is run after the AST loop because otherwise
    // if the parent timeline's collected styles were updated then
    // it would pass in invalid data into the new-to-be forked items
    innerTimelines.forEach(
        timeline => context.currentTimeline.mergeTimelineCollectedStyles(timeline));
    context.transformIntoNewTimeline(furthestTime);
    context.previousNode = ast;
  }

  visitTiming(ast: TimingAst, context: AnimationTimelineContext): AnimateTimings {
    if (ast instanceof DynamicTimingAst) {
      const strValue = context.locals ?
          interpolateLocals(ast.value, context.locals, context.errors) :
          ast.value.toString();
      return resolveTiming(strValue, context.errors);
    } else {
      return {duration: ast.duration, delay: ast.delay, easing: ast.easing};
    }
  }

  visitAnimate(ast: AnimateAst, context: AnimationTimelineContext) {
    const timings = context.currentAnimateTimings = this.visitTiming(ast.timings, context);
    if (timings.delay) {
      context.incrementTime(timings.delay);
      context.currentTimeline.snapshotCurrentStyles();
    }

    const style = ast.style;
    if (style instanceof KeyframesAst) {
      this.visitKeyframes(style, context);
    } else {
      context.incrementTime(timings.duration);
      this.visitStyle(style as StyleAst, context);
    }

    context.currentAnimateTimings = null;
    context.previousNode = ast;
  }

  visitStyle(ast: StyleAst, context: AnimationTimelineContext) {
    // this is a special case when a style() call is issued directly after
    // a call to animate(). If the clock is not forwarded by one frame then
    // the style() calls will be merged into the previous animate() call
    // which is incorrect.
    if (!context.currentAnimateTimings && context.previousNode instanceof AnimateAst) {
      context.currentTimeline.forwardFrame();
    }

    const easing =
        (context.currentAnimateTimings && context.currentAnimateTimings.easing) || ast.easing;
    this._applyStyles(ast.styles, easing, ast.isEmptyStep, context);
    context.previousNode = ast;
  }

  private _applyStyles(
      styles: (ɵStyleData|string)[], easing: string|null, treatAsEmptyStep: boolean,
      context: AnimationTimelineContext): void {
    context.currentTimeline.setStyles(
        styles, easing, treatAsEmptyStep, context.errors, context.locals);
  }

  visitKeyframes(ast: KeyframesAst, context: AnimationTimelineContext) {
    const currentAnimateTimings = context.currentAnimateTimings !;
    const startTime = (context.currentTimeline !).duration;
    const duration = currentAnimateTimings.duration;
    const innerContext = context.createSubContext();
    const innerTimeline = innerContext.currentTimeline;
    innerTimeline.easing = currentAnimateTimings.easing;

    ast.styles.forEach(step => {
      innerTimeline.forwardTime(step.offset * duration);
      this._applyStyles(step.styles, step.easing, false, innerContext);
    });

    // this will ensure that the parent timeline gets all the styles from
    // the child even if the new timeline below is not used
    context.currentTimeline.mergeTimelineCollectedStyles(innerTimeline);

    // we do this because the window between this timeline and the sub timeline
    // should ensure that the styles within are exactly the same as they were before
    context.transformIntoNewTimeline(startTime + duration);
    context.previousNode = ast;
  }

  visitQuery(ast: QueryAst, context: AnimationTimelineContext) {
    // in the event that the first step before this is a style step we need
    // to ensure the styles are applied before the children are animated
    const startTime = context.currentTimeline.currentTime;
    const locals = ast.locals || {};
    const hasDelay = locals.hasOwnProperty('delay');

    if (context.previousNode instanceof StyleAst ||
        (startTime == 0 && context.currentTimeline.getCurrentStyleProperties().length)) {
      context.currentTimeline.forwardFrame();
      context.currentTimeline.snapshotCurrentStyles();
      context.previousNode = DEFAULT_NOOP_PREVIOUS_NODE;
    }

    let furthestTime = startTime;
    const elms = invokeQuery(
        context.element, ast.selector, ast.originalSelector, ast.multi, ast.includeSelf,
        locals['optional'] ? true : false, context.errors);

    context.currentQueryTotal = elms.length;
    let sameElementTimeline: TimelineBuilder|null = null;
    elms.forEach((element, i) => {

      context.currentQueryIndex = i;
      const innerContext = context.createSubContext(ast.locals, element);
      if (hasDelay) {
        innerContext.delayNextStep(innerContext.locals['delay'] as number);
      }

      let tl = innerContext.currentTimeline;
      if (element === context.element) {
        sameElementTimeline = tl;
      }

      const startTime = tl.currentTime;

      ast.animation.visit(this, innerContext);

      tl = innerContext.currentTimeline;
      let endTime = tl.currentTime;

      // this means that the query itself ONLY took on styling calls. When this
      // happens we need to gaurantee that the styles are applied on screen.
      if (innerContext.previousNode instanceof StyleAst && startTime == endTime) {
        tl.forwardFrame();
        tl.snapshotCurrentStyles();
        endTime = tl.currentTime;
        innerContext.previousNode = DEFAULT_NOOP_PREVIOUS_NODE;
      }

      furthestTime = Math.max(furthestTime, endTime);
    });

    context.currentQueryIndex = 0;
    context.currentQueryTotal = 0;
    context.transformIntoNewTimeline(furthestTime);

    if (sameElementTimeline) {
      context.currentTimeline.mergeTimelineCollectedStyles(sameElementTimeline);
      context.currentTimeline.snapshotCurrentStyles();
    }

    context.previousNode = ast;
  }

  visitStagger(ast: StaggerAst, context: AnimationTimelineContext) {
    const parentContext = context.parentContext !;
    const tl = context.currentTimeline;
    const timings = ast.timings;
    const duration = Math.abs(timings.duration);
    const maxTime = duration * (context.currentQueryTotal - 1);
    let delay = duration * context.currentQueryIndex;

    let staggerTransformer = timings.duration < 0 ? 'reverse' : timings.easing;
    switch (staggerTransformer) {
      case 'reverse':
        delay = maxTime - delay;
        break;
      case 'full':
        delay = parentContext.currentStaggerTime;
        break;
    }

    if (delay) {
      context.currentTimeline.delayNextStep(delay);
    }

    const startingTime = context.currentTimeline.currentTime;
    ast.animation.visit(this, context);
    context.previousNode = ast;

    // time = duration + delay
    // the reason why this computation is so complex is because
    // the inner timeline may either have a delay value or a stretched
    // keyframe depending on if a subtimeline is not used or is used.
    parentContext.currentStaggerTime =
        (tl.currentTime - startingTime) + (tl.startTime - parentContext.currentTimeline.startTime);
  }
}

export class TimelineBuilder {
  public duration: number = 0;
  public easing: string|null;
  private _previousKeyframe: ɵStyleData = {};
  private _currentKeyframe: ɵStyleData = {};
  private _keyframes = new Map<number, ɵStyleData>();
  private _styleSummary: {[prop: string]: StyleAtTime} = {};
  private _localTimelineStyles: ɵStyleData;
  private _globalTimelineStyles: ɵStyleData;
  private _backFill: ɵStyleData = {};
  private _currentEmptyStepKeyframe: ɵStyleData|null = null;

  constructor(
      public element: any, public startTime: number,
      private _elementTimelineStylesLookup?: Map<any, ɵStyleData>) {
    if (!this._elementTimelineStylesLookup) {
      this._elementTimelineStylesLookup = new Map<any, ɵStyleData>();
    }
    this._localTimelineStyles = Object.create(this._backFill, {});
    this._globalTimelineStyles = this._elementTimelineStylesLookup.get(element) !;
    if (!this._globalTimelineStyles) {
      this._globalTimelineStyles = this._localTimelineStyles;
      this._elementTimelineStylesLookup.set(element, this._localTimelineStyles);
    }
    this._loadKeyframe();
  }

  containsAnimation(): boolean { return this._keyframes.size > 1; }

  getCurrentStyleProperties(): string[] { return Object.keys(this._currentKeyframe); }

  get currentTime() { return this.startTime + this.duration; }

  delayNextStep(delay: number) {
    if (this.duration == 0) {
      this.startTime += delay;
    } else {
      this.forwardTime(this.currentTime + delay);
    }
  }

  fork(element: any, currentTime = 0): TimelineBuilder {
    return new TimelineBuilder(
        element, currentTime || this.currentTime, this._elementTimelineStylesLookup);
  }

  private _loadKeyframe() {
    if (this._currentKeyframe) {
      this._previousKeyframe = this._currentKeyframe;
    }
    this._currentKeyframe = this._keyframes.get(this.duration) !;
    if (!this._currentKeyframe) {
      this._currentKeyframe = Object.create(this._backFill, {});
      this._keyframes.set(this.duration, this._currentKeyframe);
    }
  }

  forwardFrame() {
    this.duration++;
    this._loadKeyframe();
  }

  forwardTime(time: number) {
    this.duration = time;
    this._loadKeyframe();
  }

  private _updateStyle(prop: string, value: string|number) {
    if (prop != 'easing') {
      this._localTimelineStyles[prop] = value;
      this._globalTimelineStyles[prop] = value;
      this._styleSummary[prop] = {time: this.currentTime, value};
    }
  }

  allowOnlyTimelineStyles() { return this._currentEmptyStepKeyframe !== this._currentKeyframe; }

  setStyles(
      input: (ɵStyleData|string)[], easing: string|null, treatAsEmptyStep: boolean, errors: any[],
      locals?: {[name: string]: any}) {
    if (easing) {
      this._previousKeyframe['easing'] = easing;
    }

    if (treatAsEmptyStep) {
      // special case for animate(duration):
      // all missing styles are filled with a `*` value then
      // if any destination styles are filled in later on the same
      // keyframe then they will override the overridden styles
      // We use `_globalTimelineStyles` here because there may be
      // styles in previous keyframes that are not present in this timeline
      Object.keys(this._globalTimelineStyles).forEach(prop => {
        this._backFill[prop] = this._globalTimelineStyles[prop] || AUTO_STYLE;
        this._currentKeyframe[prop] = AUTO_STYLE;
      });
      this._currentEmptyStepKeyframe = this._currentKeyframe;
    } else {
      const styles = flattenStyles(input, this._globalTimelineStyles);
      Object.keys(styles).forEach(prop => {
        let val = styles[prop];
        if (locals) {
          val = interpolateLocals(styles[prop], locals, errors);
        }

        this._currentKeyframe[prop] = val;
        if (!this._localTimelineStyles[prop]) {
          this._backFill[prop] = this._globalTimelineStyles.hasOwnProperty(prop) ?
              this._globalTimelineStyles[prop] :
              AUTO_STYLE;
        }
        this._updateStyle(prop, val);
      });

      Object.keys(this._localTimelineStyles).forEach(prop => {
        if (!this._currentKeyframe.hasOwnProperty(prop)) {
          this._currentKeyframe[prop] = this._localTimelineStyles[prop];
        }
      });
    }
  }

  snapshotCurrentStyles() { copyStyles(this._localTimelineStyles, false, this._currentKeyframe); }

  getFinalKeyframe() { return this._keyframes.get(this.duration); }

  get properties() {
    const properties: string[] = [];
    for (let prop in this._currentKeyframe) {
      properties.push(prop);
    }
    return properties;
  }

  mergeTimelineCollectedStyles(timeline: TimelineBuilder) {
    Object.keys(timeline._styleSummary).forEach(prop => {
      const details0 = this._styleSummary[prop];
      const details1 = timeline._styleSummary[prop];
      if (!details0 || details1.time > details0.time) {
        this._updateStyle(prop, details1.value);
      }
    });
  }

  buildKeyframes(): AnimationTimelineInstruction {
    const preStyleProps = new Set<string>();
    const postStyleProps = new Set<string>();
    const finalKeyframes: ɵStyleData[] = [];
    this._keyframes.forEach((keyframe, time) => {
      const finalKeyframe = copyStyles(keyframe, true);
      Object.keys(finalKeyframe).forEach(prop => {
        const value = finalKeyframe[prop];
        if (value == PRE_STYLE) {
          preStyleProps.add(prop);
        } else if (value == AUTO_STYLE) {
          postStyleProps.add(prop);
        }
      });
      finalKeyframe['offset'] = time / this.duration;
      finalKeyframes.push(finalKeyframe);
    });

    const preProps: string[] = preStyleProps.size ? iteratorToArray(preStyleProps.values()) : [];
    const postProps: string[] = postStyleProps.size ? iteratorToArray(postStyleProps.values()) : [];

    return createTimelineInstruction(
        this.element, finalKeyframes, preProps, postProps, this.duration, this.startTime,
        this.easing, false);
  }
}

class SubTimelineBuilder extends TimelineBuilder {
  public timings: AnimateTimings;

  constructor(
      public element: any, public keyframes: ɵStyleData[], public preStyleProps: string[],
      public postStyleProps: string[], timings: AnimateTimings,
      private _stretchStartingKeyframe: boolean = false) {
    super(element, timings.delay);
    this.timings = {duration: timings.duration, delay: timings.delay, easing: timings.easing};
  }

  containsAnimation(): boolean { return this.keyframes.length > 1; }

  buildKeyframes(): AnimationTimelineInstruction {
    let keyframes = this.keyframes;
    let {delay, duration, easing} = this.timings;
    if (this._stretchStartingKeyframe && delay) {
      const newKeyframes: ɵStyleData[] = [];
      const totalTime = duration + delay;
      const startingGap = delay / totalTime;

      // the original starting keyframe now starts once the delay is done
      const newFirstKeyframe = copyStyles(keyframes[0], false);
      newFirstKeyframe['offset'] = 0;
      newKeyframes.push(newFirstKeyframe);

      const oldFirstKeyframe = copyStyles(keyframes[0], false);
      oldFirstKeyframe['offset'] = roundOffset(startingGap);
      newKeyframes.push(oldFirstKeyframe);

      /*
        When the keyframe is stretched then it means that the delay before the animation
        starts is gone. Instead the first keyframe is placed at the start of the animation
        and it is then copied to where it starts when the original delay is over. This basically
        means nothing animates during that delay, but the styles are still renderered. For this
        to work the original offset values that exist in the original keyframes must be "warped"
        so that they can take the new keyframe + delay into account.

        delay=1000, duration=1000, keyframes = 0 .5 1

        turns into

        delay=0, duration=2000, keyframes = 0 .33 .66 1
       */

      // offsets between 1 ... n -1 are all warped by the keyframe stretch
      const limit = keyframes.length - 1;
      for (let i = 1; i <= limit; i++) {
        let kf = copyStyles(keyframes[i], false);
        const oldOffset = kf['offset'] as number;
        const timeAtKeyframe = delay + oldOffset * duration;
        kf['offset'] = roundOffset(timeAtKeyframe / totalTime);
        newKeyframes.push(kf);
      }

      // the new starting keyframe should be added at the start
      duration = totalTime;
      delay = 0;
      easing = '';

      keyframes = newKeyframes;
    }

    return createTimelineInstruction(
        this.element, keyframes, this.preStyleProps, this.postStyleProps, duration, delay, easing,
        true);
  }
}

function invokeQuery(
    rootElement: any, selector: string, originalSelector: string, multi: boolean,
    includeSelf: boolean, optional: boolean, errors: any[]): any[] {
  let results: any[] = [];
  if (includeSelf) {
    results.push(rootElement);
  }
  if (multi) {
    results.push(...rootElement.querySelectorAll(selector));
  } else if (results.length == 0) {
    const elm = rootElement.querySelector(selector);
    if (elm) {
      results.push(elm);
    }
  }
  if (!optional && results.length == 0) {
    const fn = multi ? 'queryAll' : 'query';
    errors.push(
        `\`${fn}("${originalSelector}")\` returned zero elements. (Use \`${fn}("${originalSelector}", { optional: true })\` if you wish to allow this.)`);
  }
  return results;
}

function roundOffset(offset: number, decimalPoints = 3): number {
  const mult = Math.pow(10, decimalPoints - 1);
  return Math.round(offset * mult) / mult;
}

function flattenStyles(input: (ɵStyleData | string)[], allStyles: ɵStyleData) {
  const styles: ɵStyleData = {};
  let allProperties: string[];
  input.forEach(token => {
    if (token === '*') {
      allProperties = allProperties || Object.keys(allStyles);
      allProperties.forEach(prop => { styles[prop] = AUTO_STYLE; });
    } else {
      copyStyles(token as ɵStyleData, false, styles);
    }
  });
  return styles;
}
