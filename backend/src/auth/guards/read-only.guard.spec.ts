import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ReadOnlyGuard } from './read-only.guard';
import {
  AllowReadOnly,
  DenyReadOnly,
  READ_ONLY_ACCESS_KEY,
} from '../decorators/read-only.decorator';

describe('ReadOnlyGuard', () => {
  let guard: ReadOnlyGuard;

  // Handler réel décoré, pour vérifier aussi le câblage décorateur → Reflector.
  const contextFor = (
    method: string,
    user: { isReadOnly?: boolean } | undefined,
    decorate?: MethodDecorator,
  ): ExecutionContext => {
    class TestController {
      handler(this: void) {}
    }
    if (decorate) {
      decorate(
        TestController.prototype,
        'handler',
        Object.getOwnPropertyDescriptor(TestController.prototype, 'handler')!,
      );
    }
    return {
      getHandler: () => TestController.prototype.handler,
      getClass: () => TestController,
      switchToHttp: () => ({ getRequest: () => ({ method, user }) }),
    } as unknown as ExecutionContext;
  };

  const readOnlyUser = { isReadOnly: true };

  beforeEach(() => {
    guard = new ReadOnlyGuard(new Reflector());
  });

  it('lets a regular user write, even on a route denied to read-only accounts', () => {
    expect(guard.canActivate(contextFor('POST', { isReadOnly: false }))).toBe(
      true,
    );
    expect(
      guard.canActivate(
        contextFor('GET', { isReadOnly: false }, DenyReadOnly()),
      ),
    ).toBe(true);
  });

  it('lets a request without authenticated user through (JwtAuthGuard decides)', () => {
    expect(guard.canActivate(contextFor('POST', undefined))).toBe(true);
  });

  it.each(['POST', 'PATCH', 'PUT', 'DELETE'])(
    'rejects a %s from a read-only account',
    (method) => {
      expect(() => guard.canActivate(contextFor(method, readOnlyUser))).toThrow(
        ForbiddenException,
      );
    },
  );

  it('accepts a write on a route in the allow list', () => {
    expect(
      guard.canActivate(contextFor('POST', readOnlyUser, AllowReadOnly())),
    ).toBe(true);
  });

  it('accepts an ordinary GET from a read-only account', () => {
    expect(guard.canActivate(contextFor('GET', readOnlyUser))).toBe(true);
    expect(guard.canActivate(contextFor('HEAD', readOnlyUser))).toBe(true);
  });

  it('rejects a sensitive GET from a read-only account', () => {
    expect(() =>
      guard.canActivate(contextFor('GET', readOnlyUser, DenyReadOnly())),
    ).toThrow(ForbiddenException);
  });

  it('applies a controller-level @DenyReadOnly() to every route of the class', () => {
    class SensitiveController {
      list(this: void) {}
    }
    DenyReadOnly()(SensitiveController);
    const context = {
      getHandler: () => SensitiveController.prototype.list,
      getClass: () => SensitiveController,
      switchToHttp: () => ({
        getRequest: () => ({ method: 'GET', user: readOnlyUser }),
      }),
    } as unknown as ExecutionContext;

    expect(Reflect.getMetadata(READ_ONLY_ACCESS_KEY, SensitiveController)).toBe(
      'deny',
    );
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
