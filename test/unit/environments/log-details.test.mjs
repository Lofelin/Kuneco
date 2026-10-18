import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {logDetails,renderLogEntry} from '../../../src/features/environments/log-details.mjs';
test('structured log fields preserve quoted values and nested JSON',()=>{assert.deepEqual(logDetails('heartbeat runtime_id=abc component="local daemon"'),[['runtime_id','abc'],['component','local daemon']]);assert.deepEqual(logDetails('{"context":{"attempt":2}}'),[['context','{\n  "attempt": 2\n}']]);});
test('expanded log entries use safe text and retain keyboard button semantics',()=>{const doc=new JSDOM('').window.document;let toggled=false;const row=renderLogEntry(doc,{time:'2026-10-18T12:00:00.123Z',level:'INFO',source:'worker',message:'<img src=x onerror=alert(1)> component=test'},{id:'one',expanded:true,onToggle:()=>{toggled=true;}});assert.equal(row.querySelector('img'),null);assert.equal(row.querySelector('app-button').getAttribute('aria-expanded'),'true');assert.ok(row.querySelector('dl').textContent.includes('componenttest'));row.querySelector('app-button').click();assert.equal(toggled,true);});
