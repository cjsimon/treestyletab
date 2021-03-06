/*
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
*/

let items = [];

const now = Date.now();
let initialTime = now;
let lastTime    = now;
let deltaBetweenLastItem = 0;

export function add(aLabel) {
  const now = Date.now();
  items.push({
    label: aLabel,
    delta: now - lastTime
  });
  deltaBetweenLastItem = now - initialTime;
  lastTime = now;
}

export async function addAsync(aLabel, aAsyncTask) {
  const start = Date.now();
  if (typeof aAsyncTask == 'function')
    aAsyncTask = aAsyncTask();
  return aAsyncTask.then(aResult => {
    items.push({
      label: `(async) ${aLabel}`,
      delta: Date.now() - start,
      async: true
    });
    return aResult;
  });
}

export function toString() {
  const logs = items.map(aItem => `${aItem.delta || 0}: ${aItem.label}`);
  return `total ${deltaBetweenLastItem} msec\n${logs.join('\n')}`;
}

