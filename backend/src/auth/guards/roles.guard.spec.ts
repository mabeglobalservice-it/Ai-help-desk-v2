import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { Role } from '../../../generated/prisma/client';

describe('RolesGuard', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let guard: RolesGuard;

  const contextWithUser = (user?: { role?: Role }): ExecutionContext =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new RolesGuard(reflector as unknown as Reflector);
  });

  it('allows the request when the route has no @Roles() metadata', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    expect(guard.canActivate(contextWithUser(undefined))).toBe(true);
  });

  it('allows the request when @Roles() is an empty array', () => {
    reflector.getAllAndOverride.mockReturnValue([]);

    expect(guard.canActivate(contextWithUser({ role: Role.EMPLOYEE }))).toBe(
      true,
    );
  });

  it('allows a user whose role is in the required list', () => {
    reflector.getAllAndOverride.mockReturnValue([Role.SUPERVISOR, Role.ADMIN]);

    expect(guard.canActivate(contextWithUser({ role: Role.ADMIN }))).toBe(true);
  });

  it('rejects a user whose role is not in the required list', () => {
    reflector.getAllAndOverride.mockReturnValue([Role.SUPERVISOR, Role.ADMIN]);

    expect(guard.canActivate(contextWithUser({ role: Role.EMPLOYEE }))).toBe(
      false,
    );
  });

  it('rejects when the route requires roles but the request has no authenticated user', () => {
    reflector.getAllAndOverride.mockReturnValue([Role.ADMIN]);

    expect(guard.canActivate(contextWithUser(undefined))).toBe(false);
  });
});
