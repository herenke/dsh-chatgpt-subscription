import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as plugin from '../src/index.js';

test('plugin exports a row Config whose enabled switch defaults on', () => {
  const resolved = plugin.Config({});
  assert.equal(resolved.enabled.get(), true);
  assert.equal(plugin.Config({ enabled: false }).enabled.get(), false);
  assert.equal(resolved.webSearch, false);
});

test('disabled activation leaves the provider unregistered until the switch turns on', () => {
  const registrations = [];
  const disposals = [];
  const handlers = {};
  const logger = { info() {}, warn() {}, error() {} };
  const ctx = {
    logger,
    get: () => undefined,
    on: (event, handler) => { handlers[event] = handler; return () => {}; },
    llm: {
      registerAdapter: (providers, adapter) => {
        registrations.push({ providers, adapter });
        return () => disposals.push(providers);
      },
    },
  };
  let enabled = true;
  const config = { enabled: { get: () => enabled } };

  plugin.apply(ctx, config);
  assert.equal(registrations.length, 1);
  assert.deepEqual(registrations[0].providers, ['chatgpt-subscription']);

  enabled = false;
  handlers['loader/volatile-update']();
  assert.equal(disposals.length, 1);
  assert.deepEqual(disposals[0], ['chatgpt-subscription']);

  enabled = true;
  handlers['loader/volatile-update']();
  assert.equal(registrations.length, 2);

  // Idempotent: an unrelated volatile update while enabled changes nothing.
  handlers['loader/volatile-update']();
  assert.equal(registrations.length, 2);
  assert.equal(disposals.length, 1);
});

test('activation with the switch off never constructs a registration', () => {
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    get: () => undefined,
    on: () => () => {},
    llm: { registerAdapter: () => { throw new Error('must not register'); } },
  };
  plugin.apply(ctx, { enabled: { get: () => false } });
});

test('client half registers the Models footer card for its settings entry', () => {
  let spec;
  const window = { __ModuleLoader__: { load: (value) => { spec = value; } } };
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, { window });
  assert.equal(spec.id, 'dsh-chatgpt-subscription');

  const React = { createElement: () => null, useState: () => [], useEffect: () => {}, useRef: () => ({}) };
  const client = spec.factory(name => {
    assert.equal(name, 'react');
    return React;
  });
  assert.deepEqual([...client.inject], ['slots', 'locale', 'configForms']);

  const registered = [];
  const localeRegistrations = [];
  const lookups = [];
  const form = { getSnapshot: () => ({ status: 'ready', value: { enabled: true }, writable: true }), subscribe: () => () => {}, set: async () => true };
  const ctx = {
    effect: (fn) => fn(),
    locale: {
      register: (ns, dicts) => { localeRegistrations.push({ ns, dicts }); return () => {}; },
      bind: (ns) => (key) => `${ns}:${key}`,
    },
    configForms: { get: (entry) => { lookups.push(entry); return form; } },
    slots: {
      inject: (slot, register) => { registered.push(slot); return register(); },
      register: (options, component) => { registered.push({ options, component }); return () => {}; },
    },
  };
  client.apply(ctx);
  assert.deepEqual(lookups, ['chatgpt-subscription']);
  assert.ok(localeRegistrations.some(({ ns, dicts }) => ns === 'dsh-chatgpt-subscription' && typeof dicts.zh?.title === 'string' && typeof dicts.en?.title === 'string'));
  assert.equal(registered[0], 'settings.models.footer');
  assert.equal(registered[1].options.id, 'chatgpt-subscription');
  assert.equal(registered[1].options.name, 'settings.models.footer');
  assert.equal(typeof registered[1].component, 'function');
});
