/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import {AnimationTriggerMetadata} from '@angular/animations';
import {ɵAnimationEngine as AnimationEngine} from '@angular/animations/browser';
import {Injectable, NgZone, Renderer2, RendererFactory2, RendererStyleFlags2, RendererType2} from '@angular/core';

@Injectable()
export class AnimationRendererFactory implements RendererFactory2 {
  private _currentId: number = 0;

  constructor(
      private delegate: RendererFactory2, private _engine: AnimationEngine, private _zone: NgZone) {
    _engine.onRemovalComplete = (element: any, delegate: any) => {
      // Note: if an component element has a leave animation, and the component
      // a host leave animation, the view engine will call `removeChild` for the parent
      // component renderer as well as for the child component renderer.
      // Therefore, we need to check if we already removed the element.
      if (delegate && delegate.parentNode(element)) {
        delegate.removeChild(element.parentNode, element);
      }
    };
  }

  createRenderer(hostElement: any, type: RendererType2): Renderer2 {
    let delegate = this.delegate.createRenderer(hostElement, type);
    if (!hostElement || !type || !type.data || !type.data['animation']) return delegate;

    const componentId = type.id;
    const namespaceId = type.id + '-' + this._currentId;
    this._currentId++;

    const animationTriggers = type.data['animation'] as AnimationTriggerMetadata[];
    animationTriggers.forEach(
        trigger => this._engine.registerTrigger(
            componentId, namespaceId, hostElement, trigger.name, trigger));
    return new AnimationRenderer(delegate, this._engine, this._zone, namespaceId);
  }
}

export class AnimationRenderer implements Renderer2 {
  public destroyNode: ((node: any) => any)|null = null;
  private _flushPending: boolean = false;

  constructor(
      public delegate: Renderer2, private _engine: AnimationEngine, private _zone: NgZone,
      private _namespaceId: string) {
    this.destroyNode = this.delegate.destroyNode ? (n) => delegate.destroyNode !(n) : null;

    _zone.onMicrotaskEmpty.subscribe(() => this._flush());
  }

  get data() { return this.delegate.data; }

  destroy(): void {
    this._engine.destroy(this._namespaceId, this.delegate);
    this.delegate.destroy();
  }

  createElement(name: string, namespace?: string): any {
    return this.delegate.createElement(name, namespace);
  }

  createComment(value: string): any { return this.delegate.createComment(value); }

  createText(value: string): any { return this.delegate.createText(value); }

  selectRootElement(selectorOrNode: string|any): any {
    return this.delegate.selectRootElement(selectorOrNode);
  }

  parentNode(node: any): any { return this.delegate.parentNode(node); }

  nextSibling(node: any): any { return this.delegate.nextSibling(node); }

  setAttribute(el: any, name: string, value: string, namespace?: string): void {
    this.delegate.setAttribute(el, name, value, namespace);
  }

  removeAttribute(el: any, name: string, namespace?: string): void {
    this.delegate.removeAttribute(el, name, namespace);
  }

  addClass(el: any, name: string): void { this.delegate.addClass(el, name); }

  removeClass(el: any, name: string): void { this.delegate.removeClass(el, name); }

  setStyle(el: any, style: string, value: any, flags: RendererStyleFlags2): void {
    this.delegate.setStyle(el, style, value, flags);
  }

  removeStyle(el: any, style: string, flags: RendererStyleFlags2): void {
    this.delegate.removeStyle(el, style, flags);
  }

  setValue(node: any, value: string): void { this.delegate.setValue(node, value); }

  appendChild(parent: any, newChild: any): void {
    this.delegate.appendChild(parent, newChild);
    this._engine.onInsert(this._namespaceId, newChild, parent, false);
    this._queueFlush();
  }

  insertBefore(parent: any, newChild: any, refChild: any): void {
    this.delegate.insertBefore(parent, newChild, refChild);
    this._engine.onInsert(this._namespaceId, newChild, parent, true);
    this._queueFlush();
  }

  removeChild(parent: any, oldChild: any): void {
    this._engine.onRemove(this._namespaceId, oldChild, this.delegate);
    this._queueFlush();
  }

  setProperty(el: any, name: string, value: any): void {
    if (name.charAt(0) == '@') {
      name = name.substr(1);
      const doFlush = this._engine.setProperty(this._namespaceId, el, name, value);
      if (doFlush) {
        this._queueFlush();
      }
    } else {
      this.delegate.setProperty(el, name, value);
    }
  }

  listen(target: 'window'|'document'|'body'|any, eventName: string, callback: (event: any) => any):
      () => void {
    if (eventName.charAt(0) == '@') {
      const element = resolveElementFromTarget(target);
      let name = eventName.substr(1);
      let phase = '';
      if (name.charAt(0) != '@') {  // transition-specific
        [name, phase] = parseTriggerCallbackName(name);
      }
      return this._engine.listen(this._namespaceId, element, name, phase, (event: any) => {
        this._zone.run(() => callback(event));
      });
    }
    return this.delegate.listen(target, eventName, callback);
  }

  private _flush() {
    if (this._flushPending) {
      this._flushPending = false;
      this._engine.flush();
    }
  }

  private _queueFlush() {
    if (!this._flushPending) {
      this._flushPending = true;
    }
  }
}

function resolveElementFromTarget(target: 'window' | 'document' | 'body' | any): any {
  switch (target) {
    case 'body':
      return document.body;
    case 'document':
      return document;
    case 'window':
      return window;
    default:
      return target;
  }
}

function parseTriggerCallbackName(triggerName: string) {
  const dotIndex = triggerName.indexOf('.');
  const trigger = triggerName.substring(0, dotIndex);
  const phase = triggerName.substr(dotIndex + 1);
  return [trigger, phase];
}
