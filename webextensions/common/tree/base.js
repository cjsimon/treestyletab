/* ***** BEGIN LICENSE BLOCK ***** 
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is the Tree Style Tab.
 *
 * The Initial Developer of the Original Code is YUKI "Piro" Hiroshi.
 * Portions created by the Initial Developer are Copyright (C) 2011-2017
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s): YUKI "Piro" Hiroshi <piro.outsider.reflex@gmail.com>
 *                 wanabe <https://github.com/wanabe>
 *                 Tetsuharu OHZEKI <https://github.com/saneyuki>
 *                 Xidorn Quan <https://github.com/upsuper> (Firefox 40+ support)
 *                 lv7777 (https://github.com/lv7777)
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ******/
'use strict';

var gTargetWindow    = null;
var gRestoringTree   = false;
var gNeedRestoreTree = false;
var gScrollLockedBy  = {};

var gIsMac = /^Mac/i.test(navigator.platform);

function updateTab(aTab, aNewState = {}, aOptions = {}) {
  if ('url' in aNewState) {
    aTab.setAttribute(Constants.kCURRENT_URI, aNewState.url);
    if (aTab.dataset.discardURLAfterCompletelyLoaded &&
        aTab.dataset.discardURLAfterCompletelyLoaded != aNewState.url)
      delete aTab.dataset.discardURLAfterCompletelyLoaded;
  }

  // Loading of "about:(unknown type)" won't report new URL via tabs.onUpdated,
  // so we need to see the complete tab object.
  if (aOptions.tab && Constants.kSHORTHAND_ABOUT_URI.test(aOptions.tab.url)) {
    let shorthand = RegExp.$1;
    wait(0).then(() => { // redirect with delay to avoid infinite loop of recursive redirections.
      browser.tabs.update(aOptions.tab.id, {
        url: aOptions.tab.url.replace(Constants.kSHORTHAND_ABOUT_URI, Constants.kSHORTHAND_URIS[shorthand] || 'about:blank')
      }).catch(ApiTabs.handleMissingTabError);
      aTab.classList.add(Constants.kTAB_STATE_GROUP_TAB);
      addSpecialTabState(aTab, Constants.kTAB_STATE_GROUP_TAB);
    });
    return;
  }
  else if ('url' in aNewState &&
           aNewState.url.indexOf(Constants.kGROUP_TAB_URI) == 0) {
    aTab.classList.add(Constants.kTAB_STATE_GROUP_TAB);
    addSpecialTabState(aTab, Constants.kTAB_STATE_GROUP_TAB);
    Tabs.onGroupTabDetected.dispatch(aTab);
  }
  else if (aTab.apiTab &&
           aTab.apiTab.status == 'complete' &&
           aTab.apiTab.url.indexOf(Constants.kGROUP_TAB_URI) != 0) {
    getSpecialTabState(aTab).then(async (aStates) => {
      if (aTab.apiTab.url.indexOf(Constants.kGROUP_TAB_URI) == 0)
        return;
      // Detect group tab from different session - which can have different UUID for the URL.
      const PREFIX_REMOVER = /^moz-extension:\/\/[^\/]+/;
      const pathPart = aTab.apiTab.url.replace(PREFIX_REMOVER, '');
      if (aStates.indexOf(Constants.kTAB_STATE_GROUP_TAB) > -1 &&
          pathPart.split('?')[0] == Constants.kGROUP_TAB_URI.replace(PREFIX_REMOVER, '')) {
        const parameters = pathPart.replace(/^[^\?]+\?/, '');
        await wait(100); // for safety
        browser.tabs.update(aTab.apiTab.id, {
          url: `${Constants.kGROUP_TAB_URI}?${parameters}`
        }).catch(ApiTabs.handleMissingTabError);
        aTab.classList.add(Constants.kTAB_STATE_GROUP_TAB);
      }
      else {
        removeSpecialTabState(aTab, Constants.kTAB_STATE_GROUP_TAB);
        aTab.classList.remove(Constants.kTAB_STATE_GROUP_TAB);
      }
    });
  }

  if (aOptions.forceApply ||
      'title' in aNewState) {
    let visibleLabel = aNewState.title;
    if (aNewState && aNewState.cookieStoreId) {
      let identity = ContextualIdentities.get(aNewState.cookieStoreId);
      if (identity)
        visibleLabel = `${aNewState.title} - ${identity.name}`;
    }
    if (aOptions.forceApply && aTab.apiTab) {
      browser.sessions.getTabValue(aTab.apiTab.id, Constants.kTAB_STATE_UNREAD)
        .then(aUnread => {
          if (aUnread)
            aTab.classList.add(Constants.kTAB_STATE_UNREAD);
          else
            aTab.classList.remove(Constants.kTAB_STATE_UNREAD);
        });
    }
    else if (!Tabs.isActive(aTab) && aTab.apiTab) {
      aTab.classList.add(Constants.kTAB_STATE_UNREAD);
      browser.sessions.setTabValue(aTab.apiTab.id, Constants.kTAB_STATE_UNREAD, true);
    }
    Tabs.getTabLabelContent(aTab).textContent = aNewState.title;
    aTab.dataset.label = visibleLabel;
    Tabs.onLabelUpdated.dispatch(aTab);
  }

  const openerOfGroupTab = Tabs.isGroupTab(aTab) && Tabs.getOpenerFromGroupTab(aTab);
  const hasFavIcon       = 'favIconUrl' in aNewState;
  const maybeImageTab    = !hasFavIcon && TabFavIconHelper.maybeImageTab(aNewState);
  if (aOptions.forceApply || hasFavIcon || maybeImageTab) {
    Tabs.onFaviconUpdated.dispatch(
      aTab,
      Tabs.getSafeFaviconUrl(aNewState.favIconUrl ||
                             maybeImageTab && aNewState.url)
    );
  }
  else if (openerOfGroupTab &&
           (openerOfGroupTab.apiTab.favIconUrl ||
            TabFavIconHelper.maybeImageTab(openerOfGroupTab.apiTab))) {
    Tabs.onFaviconUpdated.dispatch(
      aTab,
      Tabs.getSafeFaviconUrl(openerOfGroupTab.apiTab.favIconUrl ||
                             openerOfGroupTab.apiTab.url)
    );
  }

  if ('status' in aNewState) {
    let reallyChanged = !aTab.classList.contains(aNewState.status);
    aTab.classList.remove(aNewState.status == 'loading' ? 'complete' : 'loading');
    aTab.classList.add(aNewState.status);
    if (aNewState.status == 'loading') {
      aTab.classList.remove(Constants.kTAB_STATE_BURSTING);
    }
    else if (!aOptions.forceApply && reallyChanged) {
      aTab.classList.add(Constants.kTAB_STATE_BURSTING);
      if (aTab.delayedBurstEnd)
        clearTimeout(aTab.delayedBurstEnd);
      aTab.delayedBurstEnd = setTimeout(() => {
        delete aTab.delayedBurstEnd;
        aTab.classList.remove(Constants.kTAB_STATE_BURSTING);
        if (!Tabs.isActive(aTab))
          aTab.classList.add(Constants.kTAB_STATE_NOT_ACTIVATED_SINCE_LOAD);
      }, configs.burstDuration);
    }
    if (aNewState.status == 'complete' &&
        aTab.apiTab &&
        aTab.apiTab.url == aTab.dataset.discardURLAfterCompletelyLoaded) {
      if (configs.autoDiscardTabForUnexpectedFocus) {
        log(' => discard accidentally restored tab ', aTab.apiTab.id);
        if (typeof browser.tabs.discard == 'function')
          browser.tabs.discard(aTab.apiTab.id);
      }
      delete aTab.dataset.discardURLAfterCompletelyLoaded;
    }
    Tabs.onStateChanged.dispatch(aTab);
  }

  if ((aOptions.forceApply ||
       'pinned' in aNewState) &&
      aNewState.pinned != aTab.classList.contains(Constants.kTAB_STATE_PINNED)) {
    if (aNewState.pinned) {
      aTab.classList.add(Constants.kTAB_STATE_PINNED);
      aTab.removeAttribute(Constants.kLEVEL); // don't indent pinned tabs!
      Tabs.onPinned.dispatch(aTab);
    }
    else {
      aTab.classList.remove(Constants.kTAB_STATE_PINNED);
      Tabs.onUnpinned.dispatch(aTab);
    }
  }

  if (aOptions.forceApply ||
      'audible' in aNewState) {
    if (aNewState.audible)
      aTab.classList.add(Constants.kTAB_STATE_AUDIBLE);
    else
      aTab.classList.remove(Constants.kTAB_STATE_AUDIBLE);
  }

  if (aOptions.forceApply ||
      'mutedInfo' in aNewState) {
    if (aNewState.mutedInfo && aNewState.mutedInfo.muted)
      aTab.classList.add(Constants.kTAB_STATE_MUTED);
    else
      aTab.classList.remove(Constants.kTAB_STATE_MUTED);
  }

  if (aTab.apiTab &&
      aTab.apiTab.audible &&
      !aTab.apiTab.mutedInfo.muted)
    aTab.classList.add(Constants.kTAB_STATE_SOUND_PLAYING);
  else
    aTab.classList.remove(Constants.kTAB_STATE_SOUND_PLAYING);

  /*
  // On Firefox, "highlighted" is same to "activated" for now...
  // https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/tabs/onHighlighted
  if (aOptions.forceApply ||
      'highlighted' in aNewState) {
    if (aNewState.highlighted)
      aTab.classList.add(Constants.kTAB_STATE_HIGHLIGHTED);
    else
      aTab.classList.remove(Constants.kTAB_STATE_HIGHLIGHTED);
  }
  */

  if (aOptions.forceApply ||
      'cookieStoreId' in aNewState) {
    for (let className of aTab.classList) {
      if (className.indexOf('contextual-identity-') == 0)
        aTab.classList.remove(className);
    }
    if (aNewState.cookieStoreId)
      aTab.classList.add(`contextual-identity-${aNewState.cookieStoreId}`);
  }

  if (aOptions.forceApply ||
      'incognito' in aNewState) {
    if (aNewState.incognito)
      aTab.classList.add(Constants.kTAB_STATE_PRIVATE_BROWSING);
    else
      aTab.classList.remove(Constants.kTAB_STATE_PRIVATE_BROWSING);
  }

  if (aOptions.forceApply ||
      'hidden' in aNewState) {
    if (aNewState.hidden) {
      if (!aTab.classList.contains(Constants.kTAB_STATE_HIDDEN)) {
        aTab.classList.add(Constants.kTAB_STATE_HIDDEN);
        Tabs.onHidden.dispatch(aTab);
      }
    }
    else if (aTab.classList.contains(Constants.kTAB_STATE_HIDDEN)) {
      aTab.classList.remove(Constants.kTAB_STATE_HIDDEN);
      Tabs.onShown.dispatch(aTab);
    }
  }

  /*
  // currently "selected" is not available on Firefox, so the class is used only by other addons.
  if (aOptions.forceApply ||
      'selected' in aNewState) {
    if (aNewState.selected)
      aTab.classList.add(Constants.kTAB_STATE_SELECTED);
    else
      aTab.classList.remove(Constants.kTAB_STATE_SELECTED);
  }
  */

  if (aOptions.forceApply ||
      'discarded' in aNewState) {
    wait(0).then(() => {
      // Don't set this class immediately, because we need to know
      // the newly focused tab *was* discarded on onTabClosed handler.
      if (aNewState.discarded)
        aTab.classList.add(Constants.kTAB_STATE_DISCARDED);
      else
        aTab.classList.remove(Constants.kTAB_STATE_DISCARDED);
    });
  }

  updateTabDebugTooltip(aTab);
}

function updateTabDebugTooltip(aTab) {
  if (!configs.debug ||
      !aTab.apiTab)
    return;
  aTab.dataset.label = `
${aTab.apiTab.title}
#${aTab.id}
(${aTab.className})
uniqueId = <%${Constants.kPERSISTENT_ID}%>
duplicated = <%duplicated%> / <%originalTabId%> / <%originalId%>
restored = <%restored%>
tabId = ${aTab.apiTab.id}
windowId = ${aTab.apiTab.windowId}
`.trim();
  aTab.setAttribute('title', aTab.dataset.label);
  aTab.uniqueId.then(aUniqueId => {
    // reget it because it can be removed from document.
    aTab = Tabs.getTabById(aTab.apiTab);
    if (!aTab)
      return;
    aTab.setAttribute('title',
                      aTab.dataset.label = aTab.dataset.label
                        .replace(`<%${Constants.kPERSISTENT_ID}%>`, aUniqueId.id)
                        .replace(`<%originalId%>`, aUniqueId.originalId)
                        .replace(`<%originalTabId%>`, aUniqueId.originalTabId)
                        .replace(`<%duplicated%>`, !!aUniqueId.duplicated)
                        .replace(`<%restored%>`, !!aUniqueId.restored));
  });
}

function updateTabFocused(aTab) {
  var oldActiveTabs = clearOldActiveStateInWindow(aTab.apiTab.windowId);
  aTab.classList.add(Constants.kTAB_STATE_ACTIVE);
  aTab.apiTab.active = true;
  aTab.classList.remove(Constants.kTAB_STATE_NOT_ACTIVATED_SINCE_LOAD);
  aTab.classList.remove(Constants.kTAB_STATE_UNREAD);
  browser.sessions.removeTabValue(aTab.apiTab.id, Constants.kTAB_STATE_UNREAD);
  return oldActiveTabs;
}

function updateParentTab(aParent) {
  if (!Tabs.ensureLivingTab(aParent))
    return;

  var children = Tabs.getChildTabs(aParent);

  if (children.some(Tabs.maybeSoundPlaying))
    aParent.classList.add(Constants.kTAB_STATE_HAS_SOUND_PLAYING_MEMBER);
  else
    aParent.classList.remove(Constants.kTAB_STATE_HAS_SOUND_PLAYING_MEMBER);

  if (children.some(Tabs.maybeMuted))
    aParent.classList.add(Constants.kTAB_STATE_HAS_MUTED_MEMBER);
  else
    aParent.classList.remove(Constants.kTAB_STATE_HAS_MUTED_MEMBER);

  updateParentTab(Tabs.getParentTab(aParent));

  Tabs.onParentTabUpdated.dispatch(aParent);
}


async function selectTabInternally(aTab, aOptions = {}) {
  log('selectTabInternally: ', dumpTab(aTab));
  if (aOptions.inRemote) {
    await browser.runtime.sendMessage({
      type:     Constants.kCOMMAND_SELECT_TAB_INTERNALLY,
      windowId: aTab.apiTab.windowId,
      tab:      aTab.id,
      options:  aOptions
    });
    return;
  }
  var container = aTab.parentNode;
  TabsContainer.incrementCounter(container, 'internalFocusCount');
  if (aOptions.silently)
    TabsContainer.incrementCounter(container, 'internalSilentlyFocusCount');
  return browser.tabs.update(aTab.apiTab.id, { active: true })
    .catch(e => {
      TabsContainer.decrementCounter(container, 'internalFocusCount');
      if (aOptions.silently)
        TabsContainer.decrementCounter(container, 'internalSilentlyFocusCount');
      ApiTabs.handleMissingTabError(e);
    });
}

function removeTabInternally(aTab, aOptions = {}) {
  return removeTabsInternally([aTab], aOptions);
}

function removeTabsInternally(aTabs, aOptions = {}) {
  aTabs = aTabs.filter(Tabs.ensureLivingTab);
  if (!aTabs.length)
    return;
  log('removeTabsInternally: ', aTabs.map(dumpTab));
  if (aOptions.inRemote || aOptions.broadcast) {
    browser.runtime.sendMessage({
      type:    Constants.kCOMMAND_REMOVE_TABS_INTERNALLY,
      tabs:    aTabs.map(aTab => aTab.id),
      options: Object.assign({}, aOptions, {
        inRemote:    false,
        broadcast:   aOptions.inRemote && !aOptions.broadcast,
        broadcasted: !!aOptions.broadcast
      })
    });
    if (aOptions.inRemote)
      return;
  }
  var container = aTabs[0].parentNode;
  TabsContainer.incrementCounter(container, 'internalClosingCount', aTabs.length);
  if (aOptions.broadcasted)
    return;
  return browser.tabs.remove(aTabs.map(aTab => aTab.apiTab.id)).catch(ApiTabs.handleMissingTabError);
}

/* move tabs */

async function moveTabsBefore(aTabs, aReferenceTab, aOptions = {}) {
  log('moveTabsBefore: ', aTabs.map(dumpTab), dumpTab(aReferenceTab), aOptions);
  if (!aTabs.length ||
      !Tabs.ensureLivingTab(aReferenceTab))
    return [];

  if (Tabs.isAllTabsPlacedBefore(aTabs, aReferenceTab)) {
    log('moveTabsBefore:no need to move');
    return [];
  }
  return moveTabsInternallyBefore(aTabs, aReferenceTab, aOptions);
}
async function moveTabBefore(aTab, aReferenceTab, aOptions = {}) {
  return moveTabsBefore([aTab], aReferenceTab, aOptions);
}

async function moveTabsInternallyBefore(aTabs, aReferenceTab, aOptions = {}) {
  if (!aTabs.length ||
      !Tabs.ensureLivingTab(aReferenceTab))
    return [];

  log('moveTabsInternallyBefore: ', aTabs.map(dumpTab), dumpTab(aReferenceTab), aOptions);
  if (aOptions.inRemote || aOptions.broadcast) {
    let message = {
      type:     Constants.kCOMMAND_MOVE_TABS_BEFORE,
      windowId: gTargetWindow,
      tabs:     aTabs.map(aTab => aTab.id),
      nextTab:  aReferenceTab.id,
      broadcasted: !!aOptions.broadcast
    };
    if (aOptions.inRemote) {
      let tabIds = await browser.runtime.sendMessage(message);
      return tabIds.map(Tabs.getTabById);
    }
    else {
      browser.runtime.sendMessage(message);
    }
  }

  var container = aTabs[0].parentNode;
  var apiTabIds = aTabs.map(aTab => aTab.apiTab.id);
  try {
    /*
      Tab elements are moved by tabs.onMoved automatically, but
      the operation is asynchronous. To help synchronous operations
      following to this operation, we need to move tabs immediately.
    */
    let oldIndexes = [aReferenceTab].concat(aTabs).map(Tabs.getTabIndex);
    for (let tab of aTabs) {
      let oldPreviousTab = Tabs.getPreviousTab(tab);
      let oldNextTab     = Tabs.getNextTab(tab);
      if (oldNextTab == aReferenceTab) // no move case
        continue;
      TabsContainer.incrementCounter(container, 'internalMovingCount');
      TabsContainer.incrementCounter(container, 'alreadyMovedTabsCount');
      container.insertBefore(tab, aReferenceTab);
      Tabs.onTabElementMoved.dispatch(tab, {
        oldPreviousTab,
        oldNextTab
      });
    }
    syncOrderOfChildTabs(aTabs.map(Tabs.getParentTab));
    if (parseInt(container.dataset.alreadyMovedTabsCount) <= 0) {
      log(' => actually nothing moved');
    }
    else {
      log('Tab nodes rearranged by moveTabsInternallyBefore:\n'+(!configs.debug ? '' :
        Array.slice(container.childNodes)
          .map(aTab => aTab.id+(aTabs.indexOf(aTab) > -1 ? '[MOVED]' : ''))
          .join('\n')
          .replace(/^/gm, ' - ')));
      let newIndexes = [aReferenceTab].concat(aTabs).map(Tabs.getTabIndex);
      let minIndex = Math.min(...oldIndexes, ...newIndexes);
      let maxIndex = Math.max(...oldIndexes, ...newIndexes);
      for (let i = minIndex, allTabs = Tabs.getAllTabs(container); i <= maxIndex; i++) {
        let tab = allTabs[i];
        if (!tab)
          continue;
        tab.apiTab.index = i;
      }

      if (!aOptions.broadcasted) {
        await aOptions.delayedMove && wait(configs.newTabAnimationDuration); // Wait until opening animation is finished.
        let [toIndex, fromIndex] = await ApiTabs.getIndex(aReferenceTab.apiTab.id, apiTabIds[0]);
        if (fromIndex < toIndex)
          toIndex--;
        browser.tabs.move(apiTabIds, {
          windowId: parseInt(container.dataset.windowId),
          index:    toIndex
        }).catch(ApiTabs.handleMissingTabError);
      }
    }
  }
  catch(e) {
    ApiTabs.handleMissingTabError(e);
    log('moveTabsInternallyBefore failed: ', String(e));
  }
  return aTabs;
}
async function moveTabInternallyBefore(aTab, aReferenceTab, aOptions = {}) {
  return moveTabsInternallyBefore([aTab], aReferenceTab, aOptions);
}

async function moveTabsAfter(aTabs, aReferenceTab, aOptions = {}) {
  log('moveTabsAfter: ', aTabs.map(dumpTab), dumpTab(aReferenceTab), aOptions);
  if (!aTabs.length ||
      !Tabs.ensureLivingTab(aReferenceTab))
    return [];

  if (Tabs.isAllTabsPlacedAfter(aTabs, aReferenceTab)) {
    log('moveTabsAfter:no need to move');
    return [];
  }
  return moveTabsInternallyAfter(aTabs, aReferenceTab, aOptions);
}
async function moveTabAfter(aTab, aReferenceTab, aOptions = {}) {
  return moveTabsAfter([aTab], aReferenceTab, aOptions);
}

async function moveTabsInternallyAfter(aTabs, aReferenceTab, aOptions = {}) {
  if (!aTabs.length ||
      !Tabs.ensureLivingTab(aReferenceTab))
    return [];

  log('moveTabsInternallyAfter: ', aTabs.map(dumpTab), dumpTab(aReferenceTab), aOptions);
  if (aOptions.inRemote || aOptions.broadcast) {
    let message = {
      type:        Constants.kCOMMAND_MOVE_TABS_AFTER,
      windowId:    gTargetWindow,
      tabs:        aTabs.map(aTab => aTab.id),
      previousTab: aReferenceTab.id,
      broadcasted: !!aOptions.broadcast
    };
    if (aOptions.inRemote) {
      let tabIds = await browser.runtime.sendMessage(message);
      return tabIds.map(Tabs.getTabById);
    }
    else {
      browser.runtime.sendMessage(message);
    }
  }

  var container = aTabs[0].parentNode;
  var apiTabIds = aTabs.map(aTab => aTab.apiTab.id);
  try {
    /*
      Tab elements are moved by tabs.onMoved automatically, but
      the operation is asynchronous. To help synchronous operations
      following to this operation, we need to move tabs immediately.
    */
    let oldIndexes = [aReferenceTab].concat(aTabs).map(Tabs.getTabIndex);
    var nextTab = Tabs.getNextTab(aReferenceTab);
    if (aTabs.indexOf(nextTab) > -1)
      nextTab = null;
    for (let tab of aTabs) {
      let oldPreviousTab = Tabs.getPreviousTab(tab);
      let oldNextTab     = Tabs.getNextTab(tab);
      if (oldNextTab == nextTab) // no move case
        continue;
      TabsContainer.incrementCounter(container, 'internalMovingCount');
      TabsContainer.incrementCounter(container, 'alreadyMovedTabsCount');
      container.insertBefore(tab, nextTab);
      Tabs.onTabElementMoved.dispatch(tab, {
        oldPreviousTab,
        oldNextTab
      });
    }
    syncOrderOfChildTabs(aTabs.map(Tabs.getParentTab));
    if (parseInt(container.dataset.alreadyMovedTabsCount) <= 0) {
      log(' => actually nothing moved');
    }
    else {
      log('Tab nodes rearranged by moveTabsInternallyAfter:\n'+(!configs.debug ? '' :
        Array.slice(container.childNodes)
          .map(aTab => aTab.id+(aTabs.indexOf(aTab) > -1 ? '[MOVED]' : ''))
          .join('\n')
          .replace(/^/gm, ' - ')));
      let newIndexes = [aReferenceTab].concat(aTabs).map(Tabs.getTabIndex);
      let minIndex = Math.min(...oldIndexes, ...newIndexes);
      let maxIndex = Math.max(...oldIndexes, ...newIndexes);
      for (let i = minIndex, allTabs = Tabs.getAllTabs(container); i <= maxIndex; i++) {
        let tab = allTabs[i];
        if (!tab)
          continue;
        tab.apiTab.index = i;
      }

      if (!aOptions.broadcasted) {
        await aOptions.delayedMove && wait(configs.newTabAnimationDuration); // Wait until opening animation is finished.
        let [toIndex, fromIndex] = await ApiTabs.getIndex(aReferenceTab.apiTab.id, apiTabIds[0]);
        if (fromIndex > toIndex)
          toIndex++;
        browser.tabs.move(apiTabIds, {
          windowId: parseInt(container.dataset.windowId),
          index:    toIndex
        }).catch(ApiTabs.handleMissingTabError);
      }
    }
  }
  catch(e) {
    ApiTabs.handleMissingTabError(e);
    log('moveTabsInternallyAfter failed: ', String(e));
  }
  return aTabs;
}
async function moveTabInternallyAfter(aTab, aReferenceTab, aOptions = {}) {
  return moveTabsInternallyAfter([aTab], aReferenceTab, aOptions);
}


/* open something in tabs */

async function loadURI(aURI, aOptions = {}) {
  if (!aOptions.windowId && gTargetWindow)
    aOptions.windowId = gTargetWindow;
  if (aOptions.inRemote) {
    await browser.runtime.sendMessage({
      type:    Constants.kCOMMAND_LOAD_URI,
      uri:     aURI,
      options: Object.assign({}, aOptions, {
        tab: aOptions.tab && aOptions.tab.id
      })
    });
    return;
  }
  try {
    let apiTabId;
    if (aOptions.tab) {
      apiTabId = aOptions.tab.apiTab.id;
    }
    else {
      let apiTabs = await browser.tabs.query({
        windowId: aOptions.windowId,
        active:   true
      });
      apiTabId = apiTabs[0].id;
    }
    await browser.tabs.update(apiTabId, {
      url: aURI
    }).catch(ApiTabs.handleMissingTabError);
  }
  catch(e) {
    ApiTabs.handleMissingTabError(e);
  }
}

function openNewTab(aOptions = {}) {
  return openURIInTab(null, aOptions);
}

async function openURIInTab(aURI, aOptions = {}) {
  var tabs = await openURIsInTabs([aURI], aOptions);
  return tabs[0];
}

async function openURIsInTabs(aURIs, aOptions = {}) {
  if (!aOptions.windowId && gTargetWindow)
    aOptions.windowId = gTargetWindow;

  return await doAndGetNewTabs(async () => {
    if (aOptions.inRemote) {
      await browser.runtime.sendMessage(Object.assign({}, aOptions, {
        type:          Constants.kCOMMAND_NEW_TABS,
        uris:          aURIs,
        parent:        aOptions.parent && aOptions.parent.id,
        opener:        aOptions.opener && aOptions.opener.id,
        insertBefore:  aOptions.insertBefore && aOptions.insertBefore.id,
        insertAfter:   aOptions.insertAfter && aOptions.insertAfter.id,
        cookieStoreId: aOptions.cookieStoreId || null,
        isOrphan:      !!aOptions.isOrphan,
        inRemote:      false
      }));
    }
    else {
      await waitUntilAllTabsAreCreated();
      let startIndex = Tabs.calculateNewTabIndex(aOptions);
      let container  = Tabs.getTabsContainer(aOptions.windowId);
      TabsContainer.incrementCounter(container, 'toBeOpenedTabsWithPositions', aURIs.length);
      if (aOptions.isOrphan)
        TabsContainer.incrementCounter(container, 'toBeOpenedOrphanTabs', aURIs.length);
      await Promise.all(aURIs.map(async (aURI, aIndex) => {
        var params = {
          windowId: aOptions.windowId,
          active:   aIndex == 0 && !aOptions.inBackground
        };
        if (aURI)
          params.url = aURI;
        if (aOptions.opener)
          params.openerTabId = aOptions.opener.apiTab.id;
        if (startIndex > -1)
          params.index = startIndex + aIndex;
        if (aOptions.cookieStoreId)
          params.cookieStoreId = aOptions.cookieStoreId;
        var apiTab = await browser.tabs.create(params);
        await waitUntilTabsAreCreated(apiTab.id);
        var tab = Tabs.getTabById(apiTab);
        if (!tab)
          throw new Error('tab is already closed');
        if (!aOptions.opener &&
            aOptions.parent &&
            !aOptions.isOrphan)
          await attachTabTo(tab, aOptions.parent, {
            insertBefore: aOptions.insertBefore,
            insertAfter:  aOptions.insertAfter,
            forceExpand:  params.active,
            broadcast:    true
          });
        else if (aOptions.insertBefore)
          await moveTabInternallyBefore(tab, aOptions.insertBefore, {
            broadcast: true
          });
        else if (aOptions.insertAfter)
          await moveTabInternallyAfter(tab, aOptions.insertAfter, {
            broadcast: true
          });
        return tab.opened;
      }));
    }
  });
}


/* group tab */

function makeGroupTabURI(aOptions = {}) {
  var base = Constants.kGROUP_TAB_URI;
  var title = encodeURIComponent(aOptions.title || '');
  var temporaryOption = aOptions.temporary ? '&temporary=true' : '' ;
  var openerTabIdOption = aOptions.openerTabId ? `&openerTabId=${aOptions.openerTabId}` : '' ;
  return `${base}?title=${title}${temporaryOption}${openerTabIdOption}`;
}


/* blocking/unblocking */

var gBlockingCount = 0;
var gBlockingThrobberCount = 0;

function blockUserOperations(aOptions = {}) {
  gBlockingCount++;
  document.documentElement.classList.add(Constants.kTABBAR_STATE_BLOCKING);
  if (aOptions.throbber) {
    gBlockingThrobberCount++;
    document.documentElement.classList.add(Constants.kTABBAR_STATE_BLOCKING_WITH_THROBBER);
  }
}

function blockUserOperationsIn(aWindowId, aOptions = {}) {
  if (gTargetWindow && gTargetWindow != aWindowId)
    return;

  if (!gTargetWindow) {
    browser.runtime.sendMessage({
      type:     Constants.kCOMMAND_BLOCK_USER_OPERATIONS,
      windowId: aWindowId,
      throbber: !!aOptions.throbber
    });
    return;
  }
  blockUserOperations(aOptions);
}

function unblockUserOperations(aOptions = {}) {
  gBlockingThrobberCount--;
  if (gBlockingThrobberCount < 0)
    gBlockingThrobberCount = 0;
  if (gBlockingThrobberCount == 0)
    document.documentElement.classList.remove(Constants.kTABBAR_STATE_BLOCKING_WITH_THROBBER);

  gBlockingCount--;
  if (gBlockingCount < 0)
    gBlockingCount = 0;
  if (gBlockingCount == 0)
    document.documentElement.classList.remove(Constants.kTABBAR_STATE_BLOCKING);
}

function unblockUserOperationsIn(aWindowId, aOptions = {}) {
  if (gTargetWindow && gTargetWindow != aWindowId)
    return;

  if (!gTargetWindow) {
    browser.runtime.sendMessage({
      type:     Constants.kCOMMAND_UNBLOCK_USER_OPERATIONS,
      windowId: aWindowId,
      throbber: !!aOptions.throbber
    });
    return;
  }
  unblockUserOperations(aOptions);
}


function broadcastTabState(aTabs, aOptions = {}) {
  if (!Array.isArray(aTabs))
    aTabs = [aTabs];
  browser.runtime.sendMessage({
    type:    Constants.kCOMMAND_BROADCAST_TAB_STATE,
    tabs:    aTabs.map(aTab => aTab.id),
    add:     aOptions.add || [],
    remove:  aOptions.remove || [],
    bubbles: !!aOptions.bubbles
  });
}


async function bookmarkTabs(aTabs, aOptions = {}) {
  try {
    if (!(await Permissions.isGranted(Permissions.BOOKMARKS)))
      throw new Error('not permitted');
  }
  catch(e) {
    notify({
      title:   browser.i18n.getMessage('bookmark_notification_notPermitted_title'),
      message: browser.i18n.getMessage('bookmark_notification_notPermitted_message')
    });
    return null;
  }
  var folderParams = {
    title: browser.i18n.getMessage('bookmarkFolder_label', aTabs[0].apiTab.title)
  };
  if (aOptions.parentId) {
    folderParams.parentId = aOptions.parentId;
    if ('index' in aOptions)
      folderParams.index = aOptions.index;
  }
  var folder = await browser.bookmarks.create(folderParams);
  for (let i = 0, maxi = aTabs.length; i < maxi; i++) {
    let tab = aTabs[i];
    await browser.bookmarks.create({
      parentId: folder.id,
      index:    i,
      title:    tab.apiTab.title,
      url:      tab.apiTab.url
    });
  }
  return folder;
}


async function getSpecialTabState(aTab) {
  const states = await browser.sessions.getTabValue(aTab.apiTab.id, Constants.kPERSISTENT_SPECIAL_TAB_STATES);
  return states || [];
}

async function addSpecialTabState(aTab, aState) {
  const states = await getSpecialTabState(aTab);
  if (states.indexOf(aState) > -1)
    return states;
  states.push(aState);
  await browser.sessions.setTabValue(aTab.apiTab.id, Constants.kPERSISTENT_SPECIAL_TAB_STATES, states);
  return states;
}

async function removeSpecialTabState(aTab, aState) {
  const states = await getSpecialTabState(aTab);
  const index = states.indexOf(aState);
  if (index < 0)
    return states;
  states.splice(index, 1);
  await browser.sessions.setTabValue(aTab.apiTab.id, Constants.kPERSISTENT_SPECIAL_TAB_STATES, states);
  return states;
}


/* TST API Helpers */

function serializeTabForTSTAPI(aTab) {
  const effectiveFavIcon = TabFavIconHelper.effectiveFavIcons.get(aTab.apiTab.id);
  const children         = Tabs.getChildTabs(aTab).map(serializeTabForTSTAPI);
  const ancestorTabIds   = Tabs.getAncestorTabs(aTab).map(aTab => aTab.apiTab.id);
  return Object.assign({}, aTab.apiTab, {
    states:   Array.slice(aTab.classList).filter(aState => Constants.kTAB_INTERNAL_STATES.indexOf(aState) < 0),
    indent:   parseInt(aTab.getAttribute(Constants.kLEVEL) || 0),
    effectiveFavIconUrl: effectiveFavIcon && effectiveFavIcon.favIconUrl,
    children, ancestorTabIds
  });
}

function getListenersForTSTAPIMessageType(aType) {
  const uniqueTargets = {};
  for (let id of Object.keys(gExternalListenerAddons)) {
    const addon = gExternalListenerAddons[id];
    if (addon.listeningTypes.indexOf(aType) > -1)
      uniqueTargets[id] = true;
  }
  return Object.keys(uniqueTargets).map(aId => gExternalListenerAddons[aId]);
}

async function sendTSTAPIMessage(aMessage, aOptions = {}) {
  const uniqueTargets = {};
  for (let addon of getListenersForTSTAPIMessageType(aMessage.type)) {
    uniqueTargets[addon.id] = true;
  }
  if (aOptions.targets) {
    if (!Array.isArray(aOptions.targets))
      aOptions.targets = [aOptions.targets];
    for (let id of aOptions.targets) {
      uniqueTargets[id] = true;
    }
  }
  return Promise.all(Object.keys(uniqueTargets).map(async (aId) => {
    try {
      let result = await browser.runtime.sendMessage(aId, aMessage);
      return {
        id:     aId,
        result: result
      };
    }
    catch(e) {
      return {
        id:    aId,
        error: e
      };
    }
  }));
}

function snapshotTree(aTargetTab, aTabs) {
  var tabs = aTabs || Tabs.getNormalTabs(aTargetTab);

  var snapshotById = {};
  function snapshotChild(aTab) {
    if (!Tabs.ensureLivingTab(aTab) || Tabs.isPinned(aTab) || Tabs.isHidden(aTab))
      return null;
    return snapshotById[aTab.id] = {
      id:            aTab.id,
      url:           aTab.apiTab.url,
      cookieStoreId: aTab.apiTab.cookieStoreId,
      active:        Tabs.isActive(aTab),
      children:      Tabs.getChildTabs(aTab).filter(aChild => !Tabs.isHidden(aChild)).map(aChild => aChild.id),
      collapsed:     Tabs.isSubtreeCollapsed(aTab),
      level:         parseInt(aTab.getAttribute(Constants.kLEVEL) || 0)
    };
  }
  var snapshotArray = tabs.map(aTab => snapshotChild(aTab));
  for (let tab of tabs) {
    let item = snapshotById[tab.id];
    if (!item)
      continue;
    let parent = Tabs.getParentTab(tab);
    item.parent = parent && parent.id;
    let next = Tabs.getNextNormalTab(tab);
    item.next = next && next.id;
    let previous = Tabs.getPreviousNormalTab(tab);
    item.previous = previous && previous.id;
  }
  var activeTab = Tabs.getCurrentTab(aTargetTab);
  return {
    target:   snapshotById[aTargetTab.id],
    active:   activeTab && snapshotById[activeTab.id],
    tabs:     snapshotArray,
    tabsById: snapshotById
  };
}

function snapshotTreeForActionDetection(aTargetTab) {
  const prevTab = Tabs.getPreviousNormalTab(aTargetTab);
  const nextTab = Tabs.getNextNormalTab(aTargetTab);
  const foundTabs = {};
  const tabs = Tabs.getAncestorTabs(prevTab)
    .concat([prevTab, aTargetTab, nextTab, Tabs.getParentTab(aTargetTab)])
    .filter(aTab => Tabs.ensureLivingTab(aTab) && !foundTabs[aTab.id] && (foundTabs[aTab.id] = true)) // uniq
    .sort((aA, aB) => aA.apiTab.index - aB.apiTab.index);
  return snapshotTree(aTargetTab, tabs);
}
