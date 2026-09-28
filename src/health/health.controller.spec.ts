import { Test, TestingModule } from '@nestjs/testing';
import { HealthCheckService } from '@nestjs/terminus';
import { HealthController } from './health.controller.js';
import { PrismaDbIndicator } from './prisma-db.indicator.js';

/**
 * Unit tests for HealthController. Both probes are mocked at the
 * `HealthCheckService` / `PrismaDbIndicator` boundary so the suite
 * does NOT need a live database.
 *
 * Spec §9 — Health Endpoint.
 *   - GIVEN app is up → THEN GET /health/live returns 200 { status: "ok" }
 *   - GIVEN DB connected → THEN GET /health/ready returns 200 { status: "ok" }
 *   - GIVEN DB unreachable → THEN GET /health/ready returns 503
 */
describe('HealthController', () => {
  let controller: HealthController;
  let db: { pingCheck: ReturnType<typeof vi.fn> };
  let checkSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    db = { pingCheck: vi.fn() };

    // Stub the entire HealthCheckService — its constructor takes private
    // deps from `@nestjs/terminus` internals that aren't part of the
    // public package export. Mocking the whole provider avoids the
    // deep-import that the package's `exports` field rejects.
    const fakeHealthCheckService = {
      check: vi.fn(),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: fakeHealthCheckService },
        { provide: PrismaDbIndicator, useValue: db },
      ],
    }).compile();

    controller = moduleRef.get(HealthController);
    checkSpy = vi.spyOn(fakeHealthCheckService, 'check');
  });

  // -------------------------------------------------------------------------
  // liveness
  // -------------------------------------------------------------------------
  describe('GET /health/live', () => {
    it('THEN returns 200 { status: "ok" } without touching the DB', () => {
      const result = controller.live();
      expect(result.status).toBe('ok');
      expect(db.pingCheck).not.toHaveBeenCalled();
      expect(checkSpy).not.toHaveBeenCalled();
    });

    it('THEN does not invoke any indicator function', () => {
      controller.live();
      expect(checkSpy).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // readiness
  // -------------------------------------------------------------------------
  describe('GET /health/ready', () => {
    it('WHEN DB ping succeeds → THEN delegates to HealthCheckService.check() with the indicator', async () => {
      checkSpy.mockResolvedValue({
        status: 'ok',
        info: { database: { status: 'up' } },
        error: {},
        details: { database: { status: 'up' } },
      });

      const result = await controller.readiness();

      expect(checkSpy).toHaveBeenCalledTimes(1);
      // The controller passes a thunk that calls pingCheck when invoked;
      // we don't invoke the thunk here (Terminus does), but we assert it
      // was registered.
      const registeredIndicators = checkSpy.mock.calls[0]?.[0] as Array<
        () => Promise<unknown>
      >;
      expect(registeredIndicators).toHaveLength(1);

      // Drive the registered thunk and assert it pings the DB.
      await registeredIndicators[0]!();
      expect(db.pingCheck).toHaveBeenCalledWith('database');

      expect(result.status).toBe('ok');
      expect(result.info?.database).toEqual({ status: 'up' });
    });

    it('WHEN DB ping fails → THEN propagates the error (Terminus maps to 503)', async () => {
      checkSpy.mockRejectedValue(new Error('connection refused'));

      await expect(controller.readiness()).rejects.toThrow('connection refused');
    });
  });
});