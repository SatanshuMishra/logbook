import assert from 'node:assert/strict';
import { dirname } from 'node:path';

export function assertHidesPointerLocation(raised, ctx, pointerPath) {
  for (const location of [pointerPath, dirname(pointerPath), ctx.projectDir]) {
    assert.equal(
      raised.includes(location),
      false,
      `the warning echoed the server location ${location}: ${raised}`,
    );
  }
}
