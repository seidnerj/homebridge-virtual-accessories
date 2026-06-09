// Fork feature: delayed triggering for switch companion sensors.
// Covers config parsing/validation, the config schemas and runtime behavior,
// so a future upstream sync can be checked by running this file alone.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { URL } from 'node:url';
import { hap, persistedAccessory } from './helpers/persistedAccessory.js';

const { Switch } = await import('../dist/accessories/virtualAccessorySwitch.js');
const { ConfigurationUtils } = await import('../dist/configuration/utils.js');
const { DurationConfiguration } = await import('../dist/configuration/configurationDuration.js');

const configurationUtils = new ConfigurationUtils({ error() {} });

function switchConfig(delay) {
  return {
    accessoryID: '1234567',
    accessoryName: 'Test accessory',
    accessoryType: 'switch',
    accessoryIsStateful: false,
    switch: { defaultState: 'off', hasCompanionSensor: true, hasResetTimer: false },
    companionSensor: { name: 'Companion', type: 'motion', ...(delay === undefined ? {} : { delay }) },
  };
}

function switchWithCompanion(t, delay) {
  const config = configurationUtils.deserializeAccessoryConfig(switchConfig(delay));
  const fixture = persistedAccessory(t, Switch, config);
  const accessory = fixture.create();
  const motion = () => accessory.companionSensor.service.getCharacteristic(hap.Characteristic.MotionDetected).value;
  return { accessory, motion };
}

test('delay config deserializes to a DurationConfiguration', () => {
  const config = configurationUtils.deserializeAccessoryConfig(switchConfig({ days: 0, minutes: 2, seconds: 30 }));
  assert.ok(config.companionSensor.delay instanceof DurationConfiguration);
  assert.equal(config.companionSensor.delay.toSeconds(), 150);
  assert.deepEqual(config.isValid(), [true, []]);
});

test('companion sensor without delay is valid', () => {
  const config = configurationUtils.deserializeAccessoryConfig(switchConfig(undefined));
  assert.equal(config.companionSensor.delay, undefined);
  assert.deepEqual(config.isValid(), [true, []]);
});

for (const [delay, field] of [
  [{ days: 8 }, 'days'],
  [{ days: 0, hours: 24 }, 'hours'],
  [{ days: 0, minutes: 60 }, 'minutes'],
  [{ days: 0, seconds: 60 }, 'seconds'],
  [{ days: 0, minutes: -1 }, 'minutes'],
]) {
  test(`out of range delay ${JSON.stringify(delay)} is rejected on ${field}`, () => {
    const config = configurationUtils.deserializeAccessoryConfig(switchConfig(delay));
    assert.deepEqual(config.isValid(), [false, [`companionSensor.delay.${field}`]]);
  });
}

test('every config schema exposes the companion sensor delay', () => {
  for (const file of ['config.schema.json', 'schemas/config.schema.es.json', 'schemas/config.schema.nl.json']) {
    const schema = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    const companion = JSON.parse(schema).schema.properties.devices.items.properties.companionSensor;
    assert.deepEqual(Object.keys(companion.properties.delay.properties), ['days', 'hours', 'minutes', 'seconds'], file);
  }
});

test('companion sensor without delay triggers immediately', async (t) => {
  const { accessory, motion } = switchWithCompanion(t, undefined);
  assert.equal(motion(), false);
  await accessory.setOnHandler(true);
  assert.equal(motion(), true);
  await accessory.setOnHandler(false);
  assert.equal(motion(), false);
});

test('companion sensor delays only the triggered state', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { accessory, motion } = switchWithCompanion(t, { days: 0, minutes: 2, seconds: 30 });
  await accessory.setOnHandler(true);
  t.mock.timers.tick(149_000);
  assert.equal(motion(), false);
  t.mock.timers.tick(1_000);
  assert.equal(motion(), true);
  await accessory.setOnHandler(false);
  assert.equal(motion(), false);
});

test('returning to the default state cancels a pending delayed trigger', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { accessory, motion } = switchWithCompanion(t, { days: 0, seconds: 10 });
  await accessory.setOnHandler(true);
  t.mock.timers.tick(5_000);
  await accessory.setOnHandler(false);
  t.mock.timers.tick(10_000);
  assert.equal(motion(), false);
});

test('re-triggering restarts the delay instead of stacking timers', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { accessory, motion } = switchWithCompanion(t, { days: 0, seconds: 10 });
  await accessory.setOnHandler(true);
  t.mock.timers.tick(5_000);
  await accessory.setOnHandler(true);
  t.mock.timers.tick(9_000);
  assert.equal(motion(), false);
  t.mock.timers.tick(1_000);
  assert.equal(motion(), true);
});

test('a zero delay triggers immediately', async (t) => {
  const { accessory, motion } = switchWithCompanion(t, { days: 0 });
  await accessory.setOnHandler(true);
  assert.equal(motion(), true);
});
