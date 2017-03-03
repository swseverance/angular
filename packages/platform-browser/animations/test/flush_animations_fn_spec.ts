/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import {AnimationPlayer, AnimationTriggerMetadata} from '@angular/animations';
import {ɵAnimationEngine as AnimationEngine} from '@angular/animations/browser'
import {Component} from '@angular/core';
import {FLUSH_ANIMATIONS_FN, TestBed} from '@angular/core/testing';
import {NoopAnimationsTestingModule} from '@angular/platform-browser/animations/testing';

export function main() {
  describe('FLUSH_ANIMATIONS_FN', function() {
    beforeEach(() => {
      TestBed.configureTestingModule({
        imports: [NoopAnimationsTestingModule],
        providers: [{provide: AnimationEngine, useClass: MockAnimationEngine}]
      });
    });

    it('should allow animations to be flushed', () => {
      const engine = TestBed.get(AnimationEngine) as MockAnimationEngine;
      expect(engine.flushCount).toEqual(0);

      const FLUSH_FN = TestBed.get(FLUSH_ANIMATIONS_FN) as() => any;
      FLUSH_FN();

      expect(engine.flushCount).toEqual(1);
    });

    it('should allow animations to be flushed during detectChanges', () => {
      @Component({selector: 'foo', template: 'bar'})
      class Cmp {
      }

      TestBed.configureTestingModule({declarations: [Cmp]});

      const engine = TestBed.get(AnimationEngine) as MockAnimationEngine;
      expect(engine.flushCount).toEqual(0);

      const fixture = TestBed.createComponent(Cmp);
      fixture.detectChanges();

      expect(engine.flushCount).toEqual(1);
    });
  });
}

class MockAnimationEngine implements AnimationEngine {
  onRemovalComplete: (delegate: any, element: any) => void;
  players: AnimationPlayer[];

  public flushCount = 0;

  registerTrigger(
      componentId: string, namespaceId: string, hostElement: any, name: string,
      metadata: AnimationTriggerMetadata): void {}

  onInsert(namespaceId: string, element: any, parent: any, insertBefore: boolean): void {}

  onRemove(namespaceId: string, element: any, context: any): void {}

  setProperty(namespaceId: string, element: any, property: string, value: any): void {}

  listen(
      namespaceId: string, element: any, eventName: string, eventPhase: string,
      callback: (event: any) => any): () => any {
    return () => {};
  }

  flush(): void { this.flushCount++; }

  destroy(namespaceId: string, context: any): void {}
}
