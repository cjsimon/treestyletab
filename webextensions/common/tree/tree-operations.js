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

async function attachTabTo(aChild, aParent, aOptions = {}) {
  if (!aParent || !aChild) {
    log('missing information: ', dumpTab(aParent), dumpTab(aChild));
    return;
  }

  log('attachTabTo: ', {
    child:            dumpTab(aChild),
    parent:           dumpTab(aParent),
    children:         aParent.getAttribute(Constants.kCHILDREN),
    insertAt:         aOptions.insertAt,
    insertBefore:     dumpTab(aOptions.insertBefore),
    insertAfter:      dumpTab(aOptions.insertAfter),
    dontMove:         aOptions.dontMove,
    dontUpdateIndent: aOptions.dontUpdateIndent,
    forceExpand:      aOptions.forceExpand,
    dontExpand:       aOptions.dontExpand,
    delayedMove:      aOptions.delayedMove,
    inRemote:         aOptions.inRemote,
    broadcast:        aOptions.broadcast,
    broadcasted:      aOptions.broadcasted,
    stack:            `${new Error().stack}\n${aOptions.stack || ''}`
  });

  if (TabInfo.isPinned(aParent) || TabInfo.isPinned(aChild)) {
    log('=> pinned tabs cannot be attached');
    return;
  }
  if (aParent.apiTab.windowId != aChild.apiTab.windowId) {
    log('=> could not attach tab to a parent in different window');
    return;
  }
  var ancestors = [aParent].concat(GetTabs.getAncestorTabs(aChild));
  if (ancestors.indexOf(aChild) > -1) {
    log('=> canceled for recursive request');
    return;
  }

  if (aOptions.dontMove) {
    aOptions.insertBefore = GetTabs.getNextTab(aChild);
    if (!aOptions.insertBefore)
      aOptions.insertAfter = GetTabs.getPreviousTab(aChild);
  }

  if (!aOptions.insertBefore && !aOptions.insertAfter) {
    let refTabs = getReferenceTabsForNewChild(aChild, aParent, aOptions);
    aOptions.insertBefore = refTabs.insertBefore;
    aOptions.insertAfter  = refTabs.insertAfter;
  }
  aOptions.insertAfter = aOptions.insertAfter || aParent;
  log('reference tabs: ', {
    next: dumpTab(aOptions.insertBefore),
    prev: dumpTab(aOptions.insertAfter)
  });

  await waitUntilAllTabsAreCreated();
  var newIndex = GetTabs.calculateNewTabIndex({
    insertBefore: aOptions.insertBefore,
    insertAfter:  aOptions.insertAfter,
    ignoreTabs:   [aChild]
  });
  log('newIndex: ', newIndex);

  var newlyAttached = (
    aParent.childTabs.indexOf(aChild) < 0 ||
    aChild.parentTab != aParent
  );
  if (!newlyAttached)
    log('=> already attached');

  var childIds;
  {
    let expectedAllTabs = GetTabs.getAllTabs(aChild).filter(aTab => aTab != aChild);
    log('expectedAllTabs: ', expectedAllTabs.map(dumpTab));
    if (newIndex >= expectedAllTabs.length)
      expectedAllTabs.push(aChild);
    else
      expectedAllTabs.splice(newIndex, 0, aChild);
    log(' => ', expectedAllTabs.map(dumpTab));

    let children = expectedAllTabs.filter(aTab => {
      return (aTab == aChild ||
                aTab.parentTab == aParent);
    });
    aParent.childTabs = children;
    childIds = children.map(aTab => aTab.id);
  }
  log('new children: ', childIds);

  if (newlyAttached) {
    detachTab(aChild, Object.assign({}, aOptions, {
      // Don't broadcast this detach operation, because this "attachTabTo" can be
      // broadcasted. If we broadcast this detach operation, the tab is detached
      // twice in the sidebar!
      broadcast: false
    }));

    aParent.setAttribute(Constants.kCHILDREN, `|${childIds.join('|')}|`);

    aChild.setAttribute(Constants.kPARENT, aParent.id);
    aChild.parentTab = aParent;
    aChild.ancestorTabs = GetTabs.getAncestorTabs(aChild, { force: true });

    let parentLevel = parseInt(aParent.getAttribute(Constants.kLEVEL) || 0);
    if (!aOptions.dontUpdateIndent) {
      updateTabsIndent(aChild, parentLevel + 1);
    }
    //updateTabAsParent(aParent);
    //if (shouldInheritIndent && !aOptions.dontUpdateIndent)
    //  this.inheritTabIndent(aChild, aParent);

    //promoteTooDeepLevelTabs(aChild);

    updateParentTab(aParent);
  }

  window.onTabAttached && onTabAttached(aChild, Object.assign({}, aOptions, {
    parent: aParent,
    newIndex, newlyAttached
  }));

  if (aOptions.inRemote || aOptions.broadcast) {
    browser.runtime.sendMessage({
      type:             Constants.kCOMMAND_ATTACH_TAB_TO,
      windowId:         aChild.apiTab.windowId,
      child:            aChild.id,
      parent:           aParent.id,
      insertAt:         aOptions.insertAt,
      insertBefore:     aOptions.insertBefore && aOptions.insertBefore.id,
      insertAfter:      aOptions.insertAfter && aOptions.insertAfter.id,
      dontMove:         !!aOptions.dontMove,
      dontUpdateIndent: !!aOptions.dontUpdateIndent,
      forceExpand:      !!aOptions.forceExpand,
      dontExpand:       !!aOptions.dontExpand,
      justNow:          !!aOptions.justNow,
      broadcasted:      !!aOptions.broadcast,
      stack:            new Error().stack
    });
  }
}

function getReferenceTabsForNewChild(aChild, aParent, aOptions = {}) {
  var insertAt = aOptions.insertAt;
  if (typeof insertAt !== 'number')
    insertAt = configs.insertNewChildAt;
  var descendants = GetTabs.getDescendantTabs(aParent);
  if (aOptions.ignoreTabs)
    descendants = descendants.filter(aTab => aOptions.ignoreTabs.indexOf(aTab) < 0);
  var insertBefore, insertAfter;
  if (descendants.length > 0) {
    let firstChild     = descendants[0];
    let lastDescendant = descendants[descendants.length-1];
    switch (insertAt) {
      case Constants.kINSERT_END:
      default:
        insertAfter = lastDescendant;
        break;
      case Constants.kINSERT_FIRST:
        insertBefore = firstChild;
        break;
      case Constants.kINSERT_NEAREST: {
        let allTabs = GetTabs.getAllTabs(aParent);
        if (aOptions.ignoreTabs)
          allTabs = allTabs.filter(aTab => aOptions.ignoreTabs.indexOf(aTab) < 0);
        let index = allTabs.indexOf(aChild);
        if (index < allTabs.indexOf(firstChild)) {
          insertBefore = firstChild;
          insertAfter  = aParent;
        }
        else if (index > allTabs.indexOf(lastDescendant)) {
          insertAfter  = lastDescendant;
        }
        else { // inside the tree
          let children = GetTabs.getChildTabs(aParent);
          if (aOptions.ignoreTabs)
            children = children.filter(aTab => aOptions.ignoreTabs.indexOf(aTab) < 0);
          for (let child of children) {
            if (index > allTabs.indexOf(child))
              continue;
            insertBefore = child;
            break;
          }
          if (!insertBefore)
            insertAfter = lastDescendant;
        }
      }; break;
    }
  }
  else {
    insertAfter = aParent;
  }
  if (insertBefore == aChild)
    insertBefore = GetTabs.getNextTab(insertBefore);
  if (insertAfter == aChild)
    insertAfter = GetTabs.getPreviousTab(insertAfter);
  // disallow to place tab in invalid position
  if (insertBefore) {
    if (GetTabs.getTabIndex(insertBefore) <= GetTabs.getTabIndex(aParent)) {
      insertBefore = null;
    }
    //TODO: we need to reject more cases...
  }
  if (insertAfter) {
    let allTabsInTree = [aParent].concat(descendants);
    let lastMember    = allTabsInTree[allTabsInTree.length - 1];
    if (GetTabs.getTabIndex(insertAfter) >= GetTabs.getTabIndex(lastMember)) {
      insertAfter = lastMember;
    }
    //TODO: we need to reject more cases...
  }
  return { insertBefore, insertAfter };
}

function detachTab(aChild, aOptions = {}) {
  log('detachTab: ', dumpTab(aChild), aOptions,
      { stack: `${new Error().stack}\n${aOptions.stack || ''}` });
  var parent = GetTabs.getParentTab(aChild);

  if (!parent)
    log('parent is already removed, or orphan tab');

  if (parent) {
    parent.childTabs = parent.childTabs.filter(aTab => aTab != aChild);
    let childIds = parent.childTabs.map(aTab => aTab.id);
    if (childIds.length == 0) {
      parent.removeAttribute(Constants.kCHILDREN);
      log('no more child');
    }
    else {
      parent.setAttribute(Constants.kCHILDREN, `|${childIds.join('|')}|`);
      log('rest children: ', childIds);
    }
    updateParentTab(parent);
  }
  aChild.removeAttribute(Constants.kPARENT);
  aChild.parentTab = null;
  aChild.ancestorTabs = [];

  updateTabsIndent(aChild);

  window.onTabDetached && onTabDetached(aChild, {
    oldParentTab: parent
  });

  if (aOptions.inRemote || aOptions.broadcast) {
    browser.runtime.sendMessage({
      type:        Constants.kCOMMAND_DETACH_TAB,
      windowId:    aChild.apiTab.windowId,
      tab:         aChild.id,
      broadcasted: !!aOptions.broadcast,
      stack:       new Error().stack
    });
  }
}

async function detachTabsFromTree(aTabs, aOptions = {}) {
  if (!Array.isArray(aTabs))
    aTabs = [aTabs];
  aTabs = Array.slice(aTabs).reverse();
  var promisedAttach = [];
  for (let tab of aTabs) {
    let children = GetTabs.getChildTabs(tab);
    let parent   = GetTabs.getParentTab(tab);
    for (let child of children) {
      if (aTabs.indexOf(child) < 0) {
        if (parent)
          promisedAttach.push(attachTabTo(child, parent, Object.assign({}, aOptions, {
            dontMove: true
          })));
        else
          detachTab(child, aOptions);
      }
    }
  }
  if (promisedAttach.length > 0)
    await Promise.all(promisedAttach);
}

function detachAllChildren(aTab, aOptions = {}) {
  var children = GetTabs.getChildTabs(aTab);
  if (!children.length)
    return;

  if (!('behavior' in aOptions))
    aOptions.behavior = Constants.kCLOSE_PARENT_BEHAVIOR_SIMPLY_DETACH_ALL_CHILDREN;
  if (aOptions.behavior == Constants.kCLOSE_PARENT_BEHAVIOR_CLOSE_ALL_CHILDREN)
    aOptions.behavior = Constants.kCLOSE_PARENT_BEHAVIOR_PROMOTE_FIRST_CHILD;

  aOptions.dontUpdateInsertionPositionInfo = true;

  var parent = GetTabs.getParentTab(aTab);
  if (TabInfo.isGroupTab(aTab) &&
      GetTabs.getTabs(aTab).filter(aTab => aTab.removing).length == children.length) {
    aOptions.behavior = Constants.kCLOSE_PARENT_BEHAVIOR_PROMOTE_ALL_CHILDREN;
    aOptions.dontUpdateIndent = false;
  }

  var nextTab = null;
  if (aOptions.behavior == Constants.kCLOSE_PARENT_BEHAVIOR_DETACH_ALL_CHILDREN &&
      !configs.moveTabsToBottomWhenDetachedFromClosedParent) {
    nextTab = GetTabs.getNextSiblingTab(GetTabs.getRootTab(aTab));
  }

  if (aOptions.behavior == Constants.kCLOSE_PARENT_BEHAVIOR_REPLACE_WITH_GROUP_TAB) {
    // open new group tab and replace the detaching tab with it.
    aOptions.behavior = Constants.kCLOSE_PARENT_BEHAVIOR_PROMOTE_ALL_CHILDREN;
  }

  if (aOptions.behavior != Constants.kCLOSE_PARENT_BEHAVIOR_DETACH_ALL_CHILDREN)
    collapseExpandSubtree(aTab, Object.assign({}, aOptions, {
      collapsed: false
    }));

  for (let i = 0, maxi = children.length; i < maxi; i++) {
    let child = children[i];
    if (aOptions.behavior == Constants.kCLOSE_PARENT_BEHAVIOR_DETACH_ALL_CHILDREN) {
      detachTab(child, aOptions);
      moveTabSubtreeBefore(child, nextTab, aOptions);
    }
    else if (aOptions.behavior == Constants.kCLOSE_PARENT_BEHAVIOR_PROMOTE_FIRST_CHILD) {
      detachTab(child, aOptions);
      if (i == 0) {
        if (parent) {
          attachTabTo(child, parent, Object.assign({}, aOptions, {
            dontExpan: true,
            dontMove:  true
          }));
        }
        collapseExpandSubtree(child, Object.assign({}, aOptions, {
          collapsed: false
        }));
        //deleteTabValue(child, Constants.kTAB_STATE_SUBTREE_COLLAPSED);
      }
      else {
        attachTabTo(child, children[0], Object.assign({}, aOptions, {
          dontExpand: true,
          dontMove:   true
        }));
      }
    }
    else if (aOptions.behavior == Constants.kCLOSE_PARENT_BEHAVIOR_PROMOTE_ALL_CHILDREN && parent) {
      attachTabTo(child, parent, Object.assign({}, aOptions, {
        dontExpand: true,
        dontMove:   true
      }));
    }
    else { // aOptions.behavior == Constants.kCLOSE_PARENT_BEHAVIOR_SIMPLY_DETACH_ALL_CHILDREN
      detachTab(child, aOptions);
    }
  }
}

async function behaveAutoAttachedTab(aTab, aOptions = {}) {
  var baseTab = aOptions.baseTab || GetTabs.getCurrentTab(gTargetWindow || aTab);
  log('behaveAutoAttachedTab ', dumpTab(aTab), dumpTab(baseTab), aOptions);
  switch (aOptions.behavior) {
    default:
      break;

    case Constants.kNEWTAB_OPEN_AS_ORPHAN:
      detachTab(aTab, {
        inRemote:  aOptions.inRemote,
        broadcast: aOptions.broadcast
      });
      if (GetTabs.getNextTab(aTab))
        await moveTabAfter(aTab, GetTabs.getLastTab(), {
          delayedMove: true,
          inRemote: aOptions.inRemote
        });
      break;

    case Constants.kNEWTAB_OPEN_AS_CHILD:
      await attachTabTo(aTab, baseTab, {
        dontMove:    aOptions.dontMove || configs.insertNewChildAt == Constants.kINSERT_NO_CONTROL,
        forceExpand: true,
        delayedMove: true,
        inRemote:    aOptions.inRemote,
        broadcast:   aOptions.broadcast
      });
      return true;
      break;

    case Constants.kNEWTAB_OPEN_AS_SIBLING: {
      let parent = GetTabs.getParentTab(baseTab);
      if (parent) {
        await attachTabTo(aTab, parent, {
          delayedMove: true,
          inRemote:  aOptions.inRemote,
          broadcast: aOptions.broadcast
        });
      }
      else {
        detachTab(aTab, {
          inRemote:  aOptions.inRemote,
          broadcast: aOptions.broadcast
        });
        await moveTabAfter(aTab, GetTabs.getLastTab(), {
          delayedMove: true,
          inRemote: aOptions.inRemote
        });
      }
      return true;
    }; break;

    case Constants.kNEWTAB_OPEN_AS_NEXT_SIBLING: {
      let nextSibling = GetTabs.getNextSiblingTab(baseTab);
      if (nextSibling == aTab)
        nextSibling = null;
      let parent = GetTabs.getParentTab(baseTab);
      if (parent)
        await attachTabTo(aTab, parent, {
          insertBefore: nextSibling,
          insertAfter:  GetTabs.getLastDescendantTab(baseTab),
          delayedMove:  true,
          inRemote:     aOptions.inRemote,
          broadcast:    aOptions.broadcast
        });
      else {
        detachTab(aTab, {
          inRemote:  aOptions.inRemote,
          broadcast: aOptions.broadcast
        });
        if (nextSibling)
          await moveTabBefore(aTab, nextSibling, {
            delayedMove: true,
            inRemote:  aOptions.inRemote,
            broadcast: aOptions.broadcast
          });
        else
          await moveTabAfter(aTab, GetTabs.getLastDescendantTab(baseTab), {
            delayedMove: true,
            inRemote:  aOptions.inRemote,
            broadcast: aOptions.broadcast
          });
      }
    }; break;
  }
}

function updateTabsIndent(aTabs, aLevel = undefined) {
  if (!aTabs)
    return;

  if (!Array.isArray(aTabs))
    aTabs = [aTabs];

  if (!aTabs.length)
    return;

  if (aLevel === undefined)
    aLevel = GetTabs.getAncestorTabs(aTabs[0]).length;

  for (let i = 0, maxi = aTabs.length; i < maxi; i++) {
    let item = aTabs[i];
    if (!item || TabInfo.isPinned(item))
      continue;

    window.onTabLevelChanged && onTabLevelChanged(item);
    item.setAttribute(Constants.kLEVEL, aLevel);
    updateTabsIndent(GetTabs.getChildTabs(item), aLevel + 1);
  }
}


// collapse/expand tabs

function shouldTabAutoExpanded(aTab) {
  return TabInfo.hasChildTabs(aTab) && TabInfo.isSubtreeCollapsed(aTab);
}

async function collapseExpandSubtree(aTab, aParams = {}) {
  aParams.collapsed = !!aParams.collapsed;
  if (!aTab)
    return;
  var remoteParams = {
    type:            Constants.kCOMMAND_CHANGE_SUBTREE_COLLAPSED_STATE,
    windowId:        parseInt(aTab.parentNode.dataset.windowId),
    tab:             aTab.id,
    collapsed:       aParams.collapsed,
    manualOperation: !!aParams.manualOperation,
    justNow:         !!aParams.justNow,
    broadcasted:     !!aParams.broadcast,
    stack:           new Error().stack
  };
  if (aParams.inRemote) {
    await browser.runtime.sendMessage(remoteParams);
    return;
  }
  if (!GetTabs.ensureLivingTab(aTab)) // it was removed while waiting
    return;
  aParams.stack = `${new Error().stack}\n${aParams.stack || ''}`;
  if (configs.logOnCollapseExpand)
    log('collapseExpandSubtree: ', dumpTab(aTab), TabInfo.isSubtreeCollapsed(aTab), aParams);
  var container = aTab.parentNode;
  await Promise.all([
    collapseExpandSubtreeInternal(aTab, aParams),
    aParams.broadcast && browser.runtime.sendMessage(remoteParams)
  ]);
}
function collapseExpandSubtreeInternal(aTab, aParams = {}) {
  if (!aParams.force &&
      TabInfo.isSubtreeCollapsed(aTab) == aParams.collapsed)
    return;

  var container = GetTabs.getTabsContainer(aTab);

  if (aParams.collapsed) {
    aTab.classList.add(Constants.kTAB_STATE_SUBTREE_COLLAPSED);
    aTab.classList.remove(Constants.kTAB_STATE_SUBTREE_EXPANDED_MANUALLY);
  }
  else {
    aTab.classList.remove(Constants.kTAB_STATE_SUBTREE_COLLAPSED);
  }
  //setTabValue(aTab, Constants.kTAB_STATE_SUBTREE_COLLAPSED, aParams.collapsed);

  var childTabs = GetTabs.getChildTabs(aTab);
  var lastExpandedTabIndex = childTabs.length - 1;
  for (let i = 0, maxi = childTabs.length; i < maxi; i++) {
    let childTab = childTabs[i];
    if (!aParams.collapsed &&
        !aParams.justNow &&
        i == lastExpandedTabIndex) {
      collapseExpandTabAndSubtree(childTab, {
        collapsed: aParams.collapsed,
        justNow:   aParams.justNow,
        anchor:    aTab,
        last:      true,
        broadcast: false
      });
    }
    else {
      collapseExpandTabAndSubtree(childTab, {
        collapsed: aParams.collapsed,
        justNow:   aParams.justNow,
        broadcast: false
      });
    }
  }

  window.onTabSubtreeCollapsedStateChanging &&
    onTabSubtreeCollapsedStateChanging(aTab);
}

function manualCollapseExpandSubtree(aTab, aParams = {}) {
  aParams.manualOperation = true;
  collapseExpandSubtree(aTab, aParams);
  if (!aParams.collapsed) {
    aTab.classList.add(Constants.kTAB_STATE_SUBTREE_EXPANDED_MANUALLY);
    //setTabValue(aTab, Constants.kTAB_STATE_SUBTREE_EXPANDED_MANUALLY, true);
  }
}

function collapseExpandTabAndSubtree(aTab, aParams = {}) {
  if (!aTab)
    return;

  var parent = GetTabs.getParentTab(aTab);
  if (!parent)
    return;

  collapseExpandTab(aTab, aParams);

  //var data = {
  //  collapsed : aParams.collapsed
  //};
  ///* PUBLIC API */
  //fireCustomEvent(Constants.kEVENT_TYPE_TAB_COLLAPSED_STATE_CHANGED, aTab, true, false, data);

  if (aParams.collapsed && TabInfo.isActive(aTab)) {
    let newSelection = GetTabs.getVisibleAncestorOrSelf(aTab);
    if (configs.logOnCollapseExpand)
      log('current tab is going to be collapsed, switch to ', dumpTab(newSelection));
    selectTabInternally(newSelection, { silently: true });
  }

  if (!TabInfo.isSubtreeCollapsed(aTab)) {
    let children = GetTabs.getChildTabs(aTab);
    children.forEach((aChild, aIndex) => {
      var last = aParams.last &&
                   (aIndex == children.length - 1);
      collapseExpandTabAndSubtree(aChild, Object.assign({}, aParams, {
        collapsed: aParams.collapsed,
        justNow:   aParams.justNow,
        anchor:    last && aParams.anchor,
        last:      last,
        broadcast: aParams.broadcast
      }));
    });
  }
}

function collapseExpandTab(aTab, aParams = {}) {
  if (TabInfo.isPinned(aTab) && aParams.collapsed) {
    log('CAUTION: a pinned tab is going to be collapsed, but canceled.',
        dumpTab(aTab), { stack: new Error().stack });
    aParams.collapsed = false;
  }

  var stack = `${new Error().stack}\n${aParams.stack || ''}`;
  if (configs.logOnCollapseExpand)
    log(`collapseExpandTab ${aTab.id} `, aParams, { stack })
  var last = aParams.last &&
               (!TabInfo.hasChildTabs(aTab) || TabInfo.isSubtreeCollapsed(aTab));
  var collapseExpandInfo = Object.assign({}, aParams, {
    anchor: last && aParams.anchor,
    last:   last
  });
  window.onTabCollapsedStateChanging &&
    window.onTabCollapsedStateChanging(aTab, collapseExpandInfo);

  if (aParams.collapsed)
    aTab.classList.add(Constants.kTAB_STATE_COLLAPSED);
  else
    aTab.classList.remove(Constants.kTAB_STATE_COLLAPSED);

  window.onTabCollapsedStateChanged &&
    window.onTabCollapsedStateChanged(aTab, collapseExpandInfo);

  if (aParams.broadcast && !aParams.broadcasted) {
    browser.runtime.sendMessage({
      type:      Constants.kCOMMAND_CHANGE_TAB_COLLAPSED_STATE,
      windowId:  aTab.apiTab.windowId,
      tab:       aTab.id,
      justNow:   aParams.justNow,
      collapsed: aParams.collapsed,
      stack:     stack,
      byAncestor: GetTabs.getAncestorTabs(aTab).some(TabInfo.isSubtreeCollapsed) == aParams.collapsed
    });
  }
}

function collapseExpandTreesIntelligentlyFor(aTab, aOptions = {}) {
  if (!aTab)
    return;

  if (configs.logOnCollapseExpand)
    log('collapseExpandTreesIntelligentlyFor');
  var container = GetTabs.getTabsContainer(aTab);
  if (parseInt(container.dataset.doingIntelligentlyCollapseExpandCount) > 0) {
    if (configs.logOnCollapseExpand)
      log('=> done by others');
    return;
  }
  incrementContainerCounter(container, 'doingIntelligentlyCollapseExpandCount');

  var sameParentTab = GetTabs.getParentTab(aTab);
  var expandedAncestors = `<${[aTab].concat(GetTabs.getAncestorTabs(aTab))
    .map(aAncestor => aAncestor.id)
    .join('><')}>`;

  var xpathResult = XPath.evaluate(
    `child::${GetTabs.kXPATH_LIVE_TAB}[
       @${Constants.kCHILDREN} and
       not(${XPath.hasClass(Constants.kTAB_STATE_COLLAPSED)}) and
       not(${XPath.hasClass(Constants.kTAB_STATE_SUBTREE_COLLAPSED)}) and
       not(contains("${expandedAncestors}", concat("<", @id, ">"))) and
       not(${XPath.hasClass(Constants.kTAB_STATE_HIDDEN)})
     ]`,
    container
  );
  if (configs.logOnCollapseExpand)
    log(`${xpathResult.snapshotLength} tabs can be collapsed`);
  for (let i = 0, maxi = xpathResult.snapshotLength; i < maxi; i++) {
    let dontCollapse = false;
    let collapseTab  = xpathResult.snapshotItem(i);
    let parentTab    = GetTabs.getParentTab(collapseTab);
    if (parentTab) {
      dontCollapse = true;
      if (!TabInfo.isSubtreeCollapsed(parentTab)) {
        for (let ancestor of GetTabs.getAncestorTabs(collapseTab)) {
          if (expandedAncestors.indexOf(`<${ancestor.id}>`) < 0)
            continue;
          dontCollapse = false;
          break;
        }
      }
    }
    if (configs.logOnCollapseExpand)
      log(`${dumpTab(collapseTab)}: dontCollapse = ${dontCollapse}`);

    let manuallyExpanded = collapseTab.classList.contains(Constants.kTAB_STATE_SUBTREE_EXPANDED_MANUALLY);
    if (!dontCollapse && !manuallyExpanded)
      collapseExpandSubtree(collapseTab, Object.assign({}, aOptions, {
        collapsed: true
      }));
  }

  collapseExpandSubtree(aTab, Object.assign({}, aOptions, {
    collapsed: false
  }));
  decrementContainerCounter(container, 'doingIntelligentlyCollapseExpandCount');
}


// operate tabs based on tree information

/*
 * By https://bugzilla.mozilla.org/show_bug.cgi?id=1366290 when the
   current tab is closed, Firefox notifies tabs.onTabRemoved at first
   and tabs.onActivated at later.
 * Basically the next (right) tab will be focused when the current tab
   is closed, except the closed tab was the last tab.
   * If the closed current tab was the last tab, then the previous tab
     is focused.
 * However, if the tab has "owner", it will be focused instead of the
   right tab if `browser.tabs.selectOwnerOnClose` == `true`.
   * The owner tab must be one of preceding tabs, because Firefox never
     open tab leftside (by default).
     So, if the next (right) tab is focused, it definitely caused by
     the closing of the current tab - except "switch to tab" command
     from the location bar.
     https://bugzilla.mozilla.org/show_bug.cgi?id=1405262
     https://github.com/piroor/treestyletab/issues/1409

So, if I ignore the bug 1405262 / issue #1409 case, "the next (right)
tab is focused after the current (active) tab is closed" means that the
focus move is unintentional and TST can override it.
*/
function tryMoveFocusFromClosingCurrentTab(aTab, aOptions = {}) {
  if (!configs.moveFocusInTreeForClosedCurrentTab)
    return;
  log('tryMoveFocusFromClosingCurrentTab', dumpTab(aTab), aOptions);
  if (!aOptions.wasActive && !TabInfo.isActive(aTab)) {
    log(' => not active tab');
    return;
  }
  aTab.parentNode.focusRedirectedForClosingCurrentTab = tryMoveFocusFromClosingCurrentTabOnFocusRedirected(aTab, aOptions);
}
async function tryMoveFocusFromClosingCurrentTabOnFocusRedirected(aTab, aOptions = {}) {
  if (!configs.moveFocusInTreeForClosedCurrentTab)
    return false;
  log('tryMoveFocusFromClosingCurrentTabOnFocusRedirected ', dumpTab(aTab), aOptions);

  // The aTab can be closed while we waiting.
  // Thus we need to get tabs related to aTab at first.
  var params      = getTryMoveFocusFromClosingCurrentTabNowParams(aTab, aOptions.params);
  var nextTab     = GetTabs.getNextTab(aTab);
  var previousTab = GetTabs.getPreviousTab(aTab);

  await aTab.closedWhileActive;
  log('tryMoveFocusFromClosingCurrentTabOnFocusRedirected: tabs.onActivated is fired');

  var autoFocusedTab = GetTabs.getCurrentTab(aTab.apiTab.windowId);
  if (autoFocusedTab != nextTab &&
      (autoFocusedTab != previousTab ||
       (GetTabs.getNextTab(autoFocusedTab) &&
        GetTabs.getNextTab(autoFocusedTab) != aTab))) {
    // possibly it is focused by browser.tabs.selectOwnerOnClose
    log('=> the tab seems focused intentionally: ', {
      autoFocused:       dumpTab(autoFocusedTab),
      nextOfAutoFocused: dumpTab(GetTabs.getNextTab(autoFocusedTab)),
      prev:              dumpTab(previousTab),
      next:              dumpTab(nextTab)
    });
    return false;
  }
  return tryMoveFocusFromClosingCurrentTabNow(aTab, { params });
}
function getTryMoveFocusFromClosingCurrentTabNowParams(aTab, aOverrideParams) {
  var parentTab = GetTabs.getParentTab(aTab);
  var params = {
    active:                    TabInfo.isActive(aTab),
    pinned:                    TabInfo.isPinned(aTab),
    parentTab,
    firstChildTab:             GetTabs.getFirstChildTab(aTab),
    firstChildTabOfParent:     GetTabs.getFirstChildTab(parentTab),
    lastChildTabOfParent:      GetTabs.getLastChildTab(parentTab),
    previousSiblingTab:        GetTabs.getPreviousSiblingTab(aTab),
    preDetectedNextFocusedTab: GetTabs.getNextFocusedTab(aTab),
    serialized:                serializeTabForTSTAPI(aTab),
    closeParentBehavior:       getCloseParentBehaviorForTab(aTab, { parentTab })
  };
  if (aOverrideParams)
    return Object.assign({}, params, aOverrideParams);
  return params;
}

async function tryMoveFocusFromClosingCurrentTabNow(aTab, aOptions = {}) {
  if (!configs.moveFocusInTreeForClosedCurrentTab)
    return false;
  var params = aOptions.params || getTryMoveFocusFromClosingCurrentTabNowParams(aTab);
  if (aOptions.ignoredTabs)
    params.ignoredTabs = aOptions.ignoredTabs;
  var {
    active,
    nextTab, nextTabUrl, nextIsDiscarded,
    parentTab, firstChildTab, firstChildTabOfParent, lastChildTabOfParent,
    previousSiblingTab, preDetectedNextFocusedTab,
    ignoredTabs,
    serialized, closeParentBehavior
  } = params;
  var tabNextFocusedByFirefox = GetTabs.getNextTab(aTab);
  log('tryMoveFocusFromClosingCurrentTabNow ', params);
  if (!active) {
    log(' => not active tab');
    return false;
  }

  var results = await sendTSTAPIMessage({
    type:   Constants.kTSTAPI_NOTIFY_TRY_MOVE_FOCUS_FROM_CLOSING_CURRENT_TAB,
    tab:    serialized,
    window: aTab.apiTab.windowId
  });
  if (results.some(aResult => aResult.result)) // canceled
    return false;

  var nextFocusedTab = null;
  if (firstChildTab &&
      (closeParentBehavior == Constants.kCLOSE_PARENT_BEHAVIOR_PROMOTE_ALL_CHILDREN ||
       closeParentBehavior == Constants.kCLOSE_PARENT_BEHAVIOR_PROMOTE_FIRST_CHILD))
    nextFocusedTab = firstChildTab;
  log('focus to first child?: ', !!nextFocusedTab);

  ignoredTabs = ignoredTabs || [];
  if (parentTab) {
    log(`tab=${dumpTab(aTab)}, parent=${dumpTab(parentTab)}, nextFocused=${dumpTab(nextFocusedTab)}, lastChildTabOfParent=${dumpTab(lastChildTabOfParent)}, previousSiblingTab=${dumpTab(previousSiblingTab)}`);
    if (!nextFocusedTab && aTab == lastChildTabOfParent) {
      if (aTab == firstChildTabOfParent) { // this is the really last child
        nextFocusedTab = parentTab;
        log('focus to parent?: ', !!nextFocusedTab);
      }
      else {
        nextFocusedTab = previousSiblingTab;
        log('focus to previous sibling?: ', !!nextFocusedTab);
      }
    }
    if (nextFocusedTab && ignoredTabs.indexOf(nextFocusedTab) > -1)
      nextFocusedTab = GetTabs.getNextFocusedTab(parentTab, { ignoredTabs });
  }
  else if (!nextFocusedTab) {
    nextFocusedTab = preDetectedNextFocusedTab;
    log('focus to GetTabs.getNextFocusedTab()?: ', !!nextFocusedTab);
  }
  if (nextFocusedTab && ignoredTabs.indexOf(nextFocusedTab) > -1) {
    nextFocusedTab = GetTabs.getNextFocusedTab(nextFocusedTab, { ignoredTabs });
    log('focus to GetTabs.getNextFocusedTab() again?: ', !!nextFocusedTab);
  }

  if (!nextFocusedTab ||
      TabInfo.isHidden(nextFocusedTab) ||
      TabInfo.isActive(nextFocusedTab))
    return false;

  nextTab = GetTabs.getTabById(nextTab);
  if (TabInfo.isActive(nextTab) &&
      nextIsDiscarded) {
    log('reserve to discard accidentally restored tab ', nextTab.apiTab.id, nextTabUrl || nextTab.apiTab.url);
    nextTab.dataset.discardURLAfterCompletelyLoaded = nextTabUrl || nextTab.apiTab.url;
  }

  log('focus to: ', dumpTab(nextFocusedTab));
  await selectTabInternally(nextFocusedTab);
  return true;
}

function getCloseParentBehaviorForTab(aTab, aOptions = {}) {
  if (!aOptions.asIndividualTab &&
      TabInfo.isSubtreeCollapsed(aTab) &&
      !aOptions.keepChildren)
    return Constants.kCLOSE_PARENT_BEHAVIOR_CLOSE_ALL_CHILDREN;

  var behavior = configs.closeParentBehavior;
  var parentTab = aOptions.parent || GetTabs.getParentTab(aTab);

  if (aOptions.keepChildren &&
      behavior != Constants.kCLOSE_PARENT_BEHAVIOR_PROMOTE_FIRST_CHILD &&
      behavior != Constants.kCLOSE_PARENT_BEHAVIOR_PROMOTE_ALL_CHILDREN)
    behavior = Constants.kCLOSE_PARENT_BEHAVIOR_PROMOTE_FIRST_CHILD;

  if (!parentTab &&
      behavior == Constants.kCLOSE_PARENT_BEHAVIOR_PROMOTE_ALL_CHILDREN &&
      configs.promoteFirstChildForClosedRoot)
    behavior = Constants.kCLOSE_PARENT_BEHAVIOR_PROMOTE_FIRST_CHILD;

  // Promote all children to upper level, if this is the last child of the parent.
  // This is similar to "taking by representation".
  if (behavior == Constants.kCLOSE_PARENT_BEHAVIOR_PROMOTE_FIRST_CHILD &&
      parentTab &&
      GetTabs.getChildTabs(parentTab).length == 1 &&
      configs.promoteAllChildrenWhenClosedParentIsLastChild)
    behavior = Constants.kCLOSE_PARENT_BEHAVIOR_PROMOTE_ALL_CHILDREN;

  return behavior;
}

function getCloseParentBehaviorForTabWithSidebarOpenState(aTab, aInfo = {}) {
  return getCloseParentBehaviorForTab(aTab, {
    keepChildren: (
      aInfo.keepChildren ||
      !shouldApplyTreeBehavior({
        windowId:            aInfo.windowId || aTab.apiTab.windowId,
        byInternalOperation: aInfo.byInternalOperation
      })
    )
  });
}

function shouldApplyTreeBehavior(aParams = {}) {
  switch (configs.parentTabBehaviorForChanges) {
    case Constants.kPARENT_TAB_BEHAVIOR_ALWAYS:
      return true;
    case Constants.kPARENT_TAB_BEHAVIOR_ONLY_WHEN_VISIBLE:
      return window.gSidebarOpenState ? (aParams.windowId && gSidebarOpenState.has(aParams.windowId)) : true ;
    default:
    case Constants.kPARENT_TAB_BEHAVIOR_ONLY_ON_SIDEBAR:
      return !!aParams.byInternalOperation;
  }
}

function syncOrderOfChildTabs(aParentTabs) {
  if (!Array.isArray(aParentTabs))
    aParentTabs = [aParentTabs];

  var updatedParentTabs = new Map();
  for (let parent of aParentTabs) {
    if (!parent || updatedParentTabs.has(parent))
      continue;
    updatedParentTabs.set(parent, true);
    if (parent.childTabs.length < 2)
      continue;
    parent.childTabs = parent.childTabs.map(aTab => {
      return {
        index: GetTabs.getTabIndex(aTab),
        tab:   aTab
      };
    }).sort((aA, aB) => aA.index - aB.index).map(aItem => aItem.tab);
    let childIds = parent.childTabs.map(aTab => aTab.id);
    parent.setAttribute(Constants.kCHILDREN, `|${childIds.join('|')}|`);
    log('updateChildTabsInfo: ', childIds);
  }
  updatedParentTabs = undefined;
}

async function moveTabSubtreeBefore(aTab, aNextTab, aOptions = {}) {
  if (!aTab)
    return;
  if (TabInfo.isAllTabsPlacedBefore([aTab].concat(GetTabs.getDescendantTabs(aTab)), aNextTab)) {
    log('moveTabSubtreeBefore:no need to move');
    return;
  }

  log('moveTabSubtreeBefore: ', dumpTab(aTab), dumpTab(aNextTab));
  var container = aTab.parentNode;
  incrementContainerCounter(container, 'subTreeMovingCount');
  try {
    await moveTabInternallyBefore(aTab, aNextTab, aOptions);
    if (!GetTabs.ensureLivingTab(aTab)) // it is removed while waiting
      throw new Error('the tab was removed before moving of descendants');
    await followDescendantsToMovedRoot(aTab, aOptions);
  }
  catch(e) {
    log(`failed to move subtree: ${String(e)}`);
  }
  await wait(0);
  if (!container.parentNode) // it was removed while waiting
    return;
  decrementContainerCounter(container, 'subTreeMovingCount');
}

async function moveTabSubtreeAfter(aTab, aPreviousTab, aOptions = {}) {
  if (!aTab)
    return;
  if (TabInfo.isAllTabsPlacedAfter([aTab].concat(GetTabs.getDescendantTabs(aTab)), aPreviousTab)) {
    log('moveTabSubtreeAfter:no need to move');
    return;
  }

  log('moveTabSubtreeAfter: ', dumpTab(aTab), dumpTab(aPreviousTab));
  var container = aTab.parentNode;
  incrementContainerCounter(container, 'subTreeMovingCount');
  try {
    await moveTabInternallyAfter(aTab, aPreviousTab, aOptions);
    if (!GetTabs.ensureLivingTab(aTab)) // it is removed while waiting
      throw new Error('the tab was removed before moving of descendants');
    await followDescendantsToMovedRoot(aTab, aOptions);
  }
  catch(e) {
    log(`failed to move subtree: ${String(e)}`);
  }
  await wait(0);
  if (!container.parentNode) // it was removed while waiting
    return;
  decrementContainerCounter(container, 'subTreeMovingCount');
}

async function followDescendantsToMovedRoot(aTab, aOptions = {}) {
  if (!TabInfo.hasChildTabs(aTab))
    return;

  log('followDescendantsToMovedRoot: ', dumpTab(aTab));
  var container = aTab.parentNode;
  incrementContainerCounter(container, 'subTreeChildrenMovingCount');
  incrementContainerCounter(container, 'subTreeMovingCount');
  await moveTabsAfter(GetTabs.getDescendantTabs(aTab), aTab, aOptions);
  decrementContainerCounter(container, 'subTreeChildrenMovingCount');
  decrementContainerCounter(container, 'subTreeMovingCount');
}

async function moveTabs(aTabs, aOptions = {}) {
  aTabs = aTabs.filter(GetTabs.ensureLivingTab);
  if (aTabs.length == 0)
    return [];

  log('moveTabs: ', aTabs.map(dumpTab), aOptions);

  var windowId = parseInt(aTabs[0].parentNode.dataset.windowId || gTargetWindow);

  var newWindow = aOptions.destinationPromisedNewWindow;

  var destinationWindowId = aOptions.destinationWindowId;
  if (!destinationWindowId && !newWindow)
    destinationWindowId = gTargetWindow;

  var isAcrossWindows = windowId != destinationWindowId || !!newWindow;

  aOptions.insertAfter = aOptions.insertAfter || GetTabs.getLastTab(destinationWindowId);

  if (aOptions.inRemote) {
    let response = await browser.runtime.sendMessage(Object.assign({}, aOptions, {
      type:                Constants.kCOMMAND_MOVE_TABS,
      windowId:            windowId,
      tabs:                aTabs.map(aTab => aTab.id),
      insertBefore:        aOptions.insertBefore && aOptions.insertBefore.id,
      insertAfter:         aOptions.insertAfter && aOptions.insertAfter.id,
      duplicate:           !!aOptions.duplicate,
      destinationWindowId: destinationWindowId,
      inRemote:            false
    }));
    return (response.movedTabs || []).map(GetTabs.getTabById).filter(aTab => !!aTab);
  }

  var movedTabs = aTabs;
  var structure = getTreeStructureFromTabs(aTabs);
  log('original tree structure: ', structure);

  if (isAcrossWindows || aOptions.duplicate) {
    blockUserOperationsIn(windowId, { throbber: true });
    try {
      let container;
      let prepareContainer = () => {
        container = GetTabs.getTabsContainer(destinationWindowId);
        if (!container) {
          container = buildTabsContainerFor(destinationWindowId);
          gAllTabs.appendChild(container);
        }
        if (isAcrossWindows) {
          incrementContainerCounter(container, 'toBeOpenedTabsWithPositions', aTabs.length);
          incrementContainerCounter(container, 'toBeOpenedOrphanTabs', aTabs.length);
          incrementContainerCounter(container, 'toBeAttachedTabs', aTabs.length);
        }
      };
      if (newWindow) {
        newWindow = newWindow.then(aWindow => {
          log('moveTabs: destination window is ready, ', aWindow);
          destinationWindowId = aWindow.id;
          prepareContainer();
          return aWindow;
        });
      }
      else {
        prepareContainer();
      }

      let apiTabs   = aTabs.map(aTab => aTab.apiTab);
      let apiTabIds = aTabs.map(aTab => aTab.apiTab.id);
      await Promise.all([
        newWindow,
        (async () => {
          let sourceContainer = aTabs[0].parentNode;
          if (aOptions.duplicate) {
            incrementContainerCounter(sourceContainer, 'toBeOpenedTabsWithPositions', aTabs.length);
            incrementContainerCounter(sourceContainer, 'toBeOpenedOrphanTabs', aTabs.length);
            incrementContainerCounter(sourceContainer, 'duplicatingTabsCount', aTabs.length);
          }
          if (isAcrossWindows)
            incrementContainerCounter(sourceContainer, 'toBeDetachedTabs', aTabs.length);

          log('preparing tabs');
          if (aOptions.duplicate) {
            let startTime = Date.now();
            // This promise will be resolved with very large delay.
            // (See also https://bugzilla.mozilla.org/show_bug.cgi?id=1394376 )
            let promisedDuplicatedTabs = Promise.all(apiTabIds.map(async (aId, aIndex) => {
              try {
                return await browser.tabs.duplicate(aId);
              }
              catch(e) {
                ApiTabs.handleMissingTabError(e);
                return null;
              }
            })).then(aAPITabs => {
              log(`ids from API responses are resolved in ${Date.now() - startTime}msec: `, aAPITabs.map(aAPITab => aAPITab.id));
              return aAPITabs;
            });
            if (configs.acceleratedTabDuplication) {
              // So, I collect duplicating tabs in different way.
              // This promise will be resolved when they actually
              // appear in the tab bar. This hack should be removed
              // after the bug 1394376 is fixed.
              let promisedDuplicatingTabs = (async () => {
                while (true) {
                  await wait(100);
                  let tabs = GetTabs.getDuplicatingTabs(windowId);
                  if (tabs.length < apiTabIds.length)
                    continue; // not opened yet
                  let tabIds = tabs.map(aTab => aTab.apiTab.id);
                  if (tabIds.join(',') == tabIds.sort().join(','))
                    continue; // not sorted yet
                  return tabs;
                }
              })().then(aAPITabs => {
                log(`ids from duplicating tabs are resolved in ${Date.now() - startTime}msec: `, aAPITabs.map(aAPITab => aAPITab.id));
                return aAPITabs;
              });
              apiTabs = await Promise.race([
                promisedDuplicatedTabs,
                promisedDuplicatingTabs
              ]);
            }
            else {
              apiTabs = await promisedDuplicatedTabs;
            }
            apiTabIds = apiTabs.map(aAPITab => aAPITab.id);
          }
        })()
      ]);
      log('moveTabs: all windows and tabs are ready, ', apiTabIds, destinationWindowId);
      let toIndex = GetTabs.getAllTabs(container).length;
      log('toIndex = ', toIndex);
      if (aOptions.insertBefore &&
          aOptions.insertBefore.apiTab.windowId == destinationWindowId) {
        try {
          let latestApiTab = await browser.tabs.get(aOptions.insertBefore.apiTab.id);
          toIndex = latestApiTab.index;
        }
        catch(e) {
          ApiTabs.handleMissingTabError(e);
          log('aOptions.insertBefore is unavailable');
        }
      }
      else if (aOptions.insertAfter &&
               aOptions.insertAfter.apiTab.windowId == destinationWindowId) {
        try {
          let latestApiTab = await browser.tabs.get(aOptions.insertAfter.apiTab.id);
          toIndex = latestApiTab.index + 1;
        }
        catch(e) {
          ApiTabs.handleMissingTabError(e);
          log('aOptions.insertAfter is unavailable');
        }
      }
      if (!isAcrossWindows &&
          aTabs[0].apiTab.index < toIndex)
        toIndex--;
      log(' => ', toIndex);
      if (isAcrossWindows) {
        for (let tab of aTabs) {
          if (!TabInfo.isActive(tab))
            continue;
          await tryMoveFocusFromClosingCurrentTabNow(tab, { ignoredTabs: aTabs });
          break;
        }
        apiTabs = await ApiTabs.safeMoveAcrossWindows(apiTabIds, {
          windowId: destinationWindowId,
          index:    toIndex
        });
        apiTabIds = apiTabs.map(aApiTab => aApiTab.id);
        log('moved across windows: ', apiTabIds);
      }

      log('applying tree structure', structure);
      // wait until tabs.onCreated are processed (for safety)
      let newTabs;
      let startTime = Date.now();
      let maxDelay = configs.maximumAcceptableDelayForTabDuplication;
      while (Date.now() - startTime < maxDelay) {
        newTabs = apiTabs.map(aApiTab => GetTabs.getTabById(TabIdFixer.fixTab(aApiTab)));
        newTabs = newTabs.filter(aTab => !!aTab);
        if (newTabs.length < aTabs.length) {
          log('retrying: ', apiTabIds, newTabs.length, aTabs.length);
          await wait(100);
          continue;
        }
        await Promise.all(newTabs.map(aTab => aTab.opened));
        await applyTreeStructureToTabs(newTabs, structure, {
          broadcast: true
        });
        if (aOptions.duplicate) {
          for (let tab of newTabs) {
            tab.classList.remove(Constants.kTAB_STATE_DUPLICATING);
            broadcastTabState(tab, {
              remove: [Constants.kTAB_STATE_DUPLICATING]
            });
          }
        }
        break;
      }

      if (!newTabs) {
        log('failed to move tabs (timeout)');
        newTabs = [];
      }
      movedTabs = newTabs;
    }
    catch(e) {
      throw e;
    }
    finally {
      unblockUserOperationsIn(windowId, { throbber: true });
    }
  }


  if (aOptions.insertBefore) {
    await moveTabsBefore(movedTabs, aOptions.insertBefore, aOptions);
  }
  else if (aOptions.insertAfter) {
    await moveTabsAfter(movedTabs, aOptions.insertAfter, aOptions);
  }
  else {
    log('no move: just duplicate or import');
  }
  // Tabs can be removed while waiting, so we need to
  // refresh the array of tabs.
  movedTabs = movedTabs.map(aTab => GetTabs.getTabById(aTab.id));
  movedTabs = movedTabs.filter(aTab => !!aTab);

  return movedTabs;
}

async function moveTab(aTab, aOptions = {}) {
  var tabs = await moveTabs([aTab], aOptions);
  return tabs[0];
}

async function openNewWindowFromTabs(aTabs, aOptions = {}) {
  if (aTabs.length == 0)
    return [];

  log('openNewWindowFromTabs: ', aTabs.map(dumpTab), aOptions);

  var windowId = parseInt(aTabs[0].parentNode.windowId || gTargetWindow);

  if (aOptions.inRemote) {
    let response = await browser.runtime.sendMessage(Object.assign({}, aOptions, {
      type:      Constants.kCOMMAND_NEW_WINDOW_FROM_TABS,
      windowId:  windowId,
      tabs:      aTabs.map(aTab => aTab.id),
      duplicate: !!aOptions.duplicate,
      left:      'left' in aOptions ? parseInt(aOptions.left) : null,
      top:       'top' in aOptions ? parseInt(aOptions.top) : null,
      inRemote:  false
    }));
    return (response.movedTabs || []).map(GetTabs.getTabById).filter(aTab => !!aTab);
  }

  log('opening new window');
  var windowParams = {
    //focused: true,  // not supported in Firefox...
    url: 'about:blank',
    incognito: TabInfo.isPrivateBrowsing(aTabs[0])
  };
  if ('left' in aOptions && aOptions.left !== null)
    windowParams.left = aOptions.left;
  if ('top' in aOptions && aOptions.top !== null)
    windowParams.top = aOptions.top;
  var newWindow;
  var promsiedNewWindow = browser.windows.create(windowParams)
    .then(aNewWindow => {
      newWindow = aNewWindow;
      log('openNewWindowFromTabs: new window is ready, ', newWindow);
      blockUserOperationsIn(newWindow.id);
      return newWindow;
    });
  aTabs = aTabs.filter(GetTabs.ensureLivingTab);
  var movedTabs = await moveTabs(aTabs, Object.assign({}, aOptions, {
    destinationPromisedNewWindow: promsiedNewWindow
  }));

  log('closing needless tabs');
  browser.windows.get(newWindow.id, { populate: true })
    .then(aApiWindow => {
      log('moved tabs: ', movedTabs.map(dumpTab));
      const movedAPITabIds = movedTabs.map(aTab => aTab.apiTab.id);
      const allTabsInWindow = aApiWindow.tabs.map(aApiTab => TabIdFixer.fixTab(aApiTab));
      const removeTabs = [];
      for (let apiTab of allTabsInWindow) {
        if (movedAPITabIds.indexOf(apiTab.id) < 0)
          removeTabs.push(GetTabs.getTabById(apiTab));
      }
      log('removing tabs: ', removeTabs.map(dumpTab));
      removeTabsInternally(removeTabs);
      unblockUserOperationsIn(newWindow.id);
    });

  return movedTabs;
}


async function groupTabs(aTabs, aOptions = {}) {
  var rootTabs = GetTabs.collectRootTabs(aTabs);
  if (rootTabs.length <= 0)
    return null;

  log('groupTabs: ', aTabs.map(dumpTab));

  var uri = makeGroupTabURI({
    title:     browser.i18n.getMessage('groupTab_label', rootTabs[0].apiTab.title),
    temporary: true
  });
  var groupTab = await openURIInTab(uri, {
    windowId:     rootTabs[0].apiTab.windowId,
    parent:       GetTabs.getParentTab(rootTabs[0]),
    insertBefore: rootTabs[0],
    inBackground: true
  });

  await detachTabsFromTree(aTabs, {
    broadcast: !!aOptions.broadcast
  });
  await moveTabsAfter(aTabs.slice(1), aTabs[0], {
    broadcast: !!aOptions.broadcast
  });
  for (let tab of rootTabs) {
    await attachTabTo(tab, groupTab, {
      forceExpand: true, // this is required to avoid the group tab itself is focused from active tab in collapsed tree
      dontMove:  true,
      broadcast: !!aOptions.broadcast
    });
  }
  return groupTab;
}


// drag and drop helper

async function performTabsDragDrop(aParams = {}) {
  var windowId = aParams.windowId || gTargetWindow;
  var destinationWindowId = aParams.destinationWindowId || windowId;

  if (aParams.inRemote) {
    browser.runtime.sendMessage(Object.assign({}, aParams, {
      type:         Constants.kCOMMAND_PERFORM_TABS_DRAG_DROP,
      windowId:     windowId,
      attachTo:     aParams.attachTo && aParams.attachTo.id,
      insertBefore: aParams.insertBefore && aParams.insertBefore.id,
      insertAfter:  aParams.insertAfter && aParams.insertAfter.id,
      inRemote:     false,
      destinationWindowId
    }));
    return;
  }

  log('performTabsDragDrop ', {
    tabs:                aParams.tabs.map(aTab => aTab.id),
    windowId:            aParams.windowId,
    destinationWindowId: aParams.destinationWindowId,
    action:              aParams.action
  });

  var draggedTabs = aParams.tabs.map(GetTabs.getTabById).filter(aTab => !!aTab);
  if (!draggedTabs.length)
    return;

  // Basically tabs should not be dragged between regular window and private browsing window,
  // so there are some codes to prevent shch operations. This is for failsafe.
  if (TabInfo.isPrivateBrowsing(draggedTabs[0]) != TabInfo.isPrivateBrowsing(GetTabs.getFirstTab(destinationWindowId)))
    return;

  var draggedRoots = GetTabs.collectRootTabs(draggedTabs);

  var draggedWholeTree = [].concat(draggedRoots);
  for (let draggedRoot of draggedRoots) {
    let descendants = GetTabs.getDescendantTabs(draggedRoot);
    for (let descendant of descendants) {
      if (draggedWholeTree.indexOf(descendant) < 0)
        draggedWholeTree.push(descendant);
    }
  }
  log('=> draggedTabs: ', draggedTabs.map(dumpTab).join(' / '));

  if (draggedWholeTree.length != draggedTabs.length) {
    log('=> partially dragged');
    if (!aParams.duplicate)
      await detachTabsFromTree(draggedTabs, {
        broadcast: true
      });
  }

  while (aParams.insertBefore &&
         draggedWholeTree.indexOf(aParams.insertBefore) > -1) {
    aParams.insertBefore = GetTabs.getNextTab(aParams.insertBefore);
  }
  while (aParams.insertAfter &&
         draggedWholeTree.indexOf(aParams.insertAfter) > -1) {
    aParams.insertAfter = GetTabs.getPreviousTab(aParams.insertAfter);
  }

  if (aParams.duplicate ||
      windowId != destinationWindowId) {
    draggedTabs = await moveTabs(draggedTabs, {
      destinationWindowId,
      duplicate:    aParams.duplicate,
      insertBefore: aParams.insertBefore,
      insertAfter:  aParams.insertAfter
    });
    draggedRoots = GetTabs.collectRootTabs(draggedTabs);
  }

  log('try attach/detach');
  if (!aParams.attachTo) {
    log('=> detach');
    detachTabsOnDrop(draggedRoots, {
      broadcast: true
    });
  }
  else if (aParams.action & Constants.kACTION_ATTACH) {
    log('=> attach');
    await attachTabsOnDrop(draggedRoots, aParams.attachTo, {
      insertBefore: aParams.insertBefore,
      insertAfter:  aParams.insertAfter,
      draggedTabs:  draggedTabs,
      broadcast:    true
    });
  }
  else {
    log('=> just moved');
  }

  log('=> moving dragged tabs ', draggedTabs.map(dumpTab));
  if (aParams.insertBefore)
    await moveTabsBefore(draggedTabs, aParams.insertBefore);
  else if (aParams.insertAfter)
    await moveTabsAfter(draggedTabs, aParams.insertAfter);
  else
    log('=> already placed at expected position');

  if (windowId != destinationWindowId) {
    // Firefox always focuses to the dropped tab if it is dragged from another window.
    // TST respects Firefox's the behavior.
    browser.tabs.update(draggedTabs[0].apiTab.id, { active: true })
      .catch(ApiTabs.handleMissingTabError);
  }

  var treeStructure = getTreeStructureFromTabs(draggedTabs);

  var newTabs;
  /*
  var replacedGroupTabs = doAndGetNewTabs(() => {
    newTabs = moveTabsInternal(draggedTabs, {
      duplicate    : aParams.duplicate,
      insertBefore : aParams.insertBefore,
      insertAfter  : aParams.insertAfter,
      inRemote     : true
    });
  });
  log('=> opened group tabs: ', replacedGroupTabs);
  aParams.draggedTab.ownerDocument.defaultView.setTimeout(() => {
    if (!GetTabs.ensureLivingTab(aTab)) // it was removed while waiting
      return;
    log('closing needless group tabs');
    replacedGroupTabs.reverse().forEach(function(aTab) {
      log(' check: ', aTab.label+'('+aTab._tPos+') '+getLoadingURI(aTab));
      if (TabInfo.isGroupTab(aTab) &&
        !TabInfo.hasChildTabs(aTab))
        removeTab(aTab);
    }, this);
  }, 0);
  */

  /*
  if (newTabs.length && aParams.action & Constants.kACTION_ATTACH) {
    Promise.all(newTabs.map((aTab) => aTab.__treestyletab__promisedDuplicatedTab))
      .then((function() {
        log('   => attach (last)');
        await attachTabsOnDrop(
          newTabs.filter(function(aTab, aIndex) {
            return treeStructure[aIndex] == -1;
          }),
          aParams.attachTo,
          { insertBefore: aParams.insertBefore,
            insertAfter:  aParams.insertAfter }
        );
      }).bind(this));
  }
  */

  log('=> finished');
}

async function attachTabsOnDrop(aTabs, aParent, aOptions = {}) {
  log('attachTabsOnDrop: start ', aTabs.map(dumpTab));
  if (aParent && !aOptions.insertBefore && !aOptions.insertAfter) {
    let refTabs = getReferenceTabsForNewChild(aTabs[0], aParent, {
      ignoreTabs: aTabs
    });
    aOptions.insertBefore = refTabs.insertBefore;
    aOptions.insertAfter  = refTabs.insertAfter;
  }

  if (aOptions.insertBefore)
    await moveTabsBefore(aOptions.draggedTabs || aTabs, aOptions.insertBefore);
  else if (aOptions.insertAfter)
    await moveTabsAfter(aOptions.draggedTabs || aTabs, aOptions.insertAfter);

  var memberOptions = Object.assign({}, aOptions, {
    insertBefore: null,
    insertAfter:  null,
    dontMove:     true,
    forceExpand:  aOptions.draggedTabs.some(TabInfo.isActive)
  });
  for (let tab of aTabs) {
    if (aParent)
      attachTabTo(tab, aParent, memberOptions);
    else
      detachTab(tab, memberOptions);
    collapseExpandTabAndSubtree(tab, Object.assign({}, memberOptions, {
      collapsed: false
    }));
  }
}

function detachTabsOnDrop(aTabs, aOptions = {}) {
  log('detachTabsOnDrop: start ', aTabs.map(dumpTab));
  for (let tab of aTabs) {
    detachTab(tab, aOptions);
    collapseExpandTabAndSubtree(tab, Object.assign({}, aOptions, {
      collapsed: false
    }));
  }
}


// set/get tree structure

function getTreeStructureFromTabs(aTabs, aOptions = {}) {
  if (!aTabs || !aTabs.length)
    return [];

  /* this returns...
    [A]     => -1 (parent is not in this tree)
      [B]   => 0 (parent is 1st item in this tree)
      [C]   => 0 (parent is 1st item in this tree)
        [D] => 2 (parent is 2nd in this tree)
    [E]     => -1 (parent is not in this tree, and this creates another tree)
      [F]   => 0 (parent is 1st item in this another tree)
  */
  return cleanUpTreeStructureArray(
    aTabs.map((aTab, aIndex) => {
      let tab = GetTabs.getParentTab(aTab);
      let index = tab ? aTabs.indexOf(tab) : -1 ;
      return index >= aIndex ? -1 : index ;
    }),
    -1
  ).map((aParentIndex, aIndex) => {
    var tab = aTabs[aIndex];
    var item = {
      id:        tab.getAttribute(Constants.kPERSISTENT_ID),
      parent:    aParentIndex,
      collapsed: TabInfo.isSubtreeCollapsed(tab)
    };
    if (aOptions.full) {
      item.title  = tab.apiTab.title;
      item.url    = tab.apiTab.url;
      item.pinned = TabInfo.isPinned(tab);
    }
    return item;
  });
}
function cleanUpTreeStructureArray(aTreeStructure, aDefaultParent) {
  var offset = 0;
  aTreeStructure = aTreeStructure
    .map((aPosition, aIndex) => {
      return (aPosition == aIndex) ? -1 : aPosition ;
    })
    .map((aPosition, aIndex) => {
      if (aPosition == -1) {
        offset = aIndex;
        return aPosition;
      }
      return aPosition - offset;
    });

  /* The final step, this validates all of values.
     Smaller than -1 is invalid, so it becomes to -1. */
  aTreeStructure = aTreeStructure.map(aIndex => {
    return aIndex < -1 ? aDefaultParent : aIndex ;
  });
  return aTreeStructure;
}

async function applyTreeStructureToTabs(aTabs, aTreeStructure, aOptions = {}) {
  if (!aTabs || !aTreeStructure)
    return;

  MetricsData.add('applyTreeStructureToTabs: start');

  log('applyTreeStructureToTabs: ', aTabs.map(dumpTab), aTreeStructure, aOptions);
  aTabs = aTabs.slice(0, aTreeStructure.length);
  aTreeStructure = aTreeStructure.slice(0, aTabs.length);

  var expandStates = aTabs.map(aTab => !!aTab);
  expandStates = expandStates.slice(0, aTabs.length);
  while (expandStates.length < aTabs.length)
    expandStates.push(-1);

  MetricsData.add('applyTreeStructureToTabs: preparation');

  var parentTab = null;
  var tabsInTree = [];
  var promises   = [];
  for (let i = 0, maxi = aTabs.length; i < maxi; i++) {
    let tab = aTabs[i];
    /*
    if (TabInfo.isCollapsed(tab))
      collapseExpandTabAndSubtree(tab, Object.assign({}, aOptions, {
        collapsed: false,
        justNow: true
      }));
    */
    detachTab(tab, { justNow: true });

    let structureInfo = aTreeStructure[i];
    let parentIndexInTree = -1;
    if (typeof structureInfo == 'number') { // legacy format
      parentIndexInTree = structureInfo;
    }
    else {
      parentIndexInTree = structureInfo.parent;
      expandStates[i]   = !structureInfo.collapsed;
    }
    if (parentIndexInTree < 0) { // there is no parent, so this is a new parent!
      parentTab  = tab.id;
      tabsInTree = [tab];
    }

    let parent = null;
    if (parentIndexInTree > -1) {
      parent = GetTabs.getTabById(parentTab);
      if (parent) {
        //log('existing tabs in tree: ', {
        //  size:   tabsInTree.length,
        //  parent: parentIndexInTree
        //});
        parent = parentIndexInTree < tabsInTree.length ? tabsInTree[parentIndexInTree] : parent ;
        tabsInTree.push(tab);
      }
    }
    if (parent) {
      parent.classList.remove(Constants.kTAB_STATE_SUBTREE_COLLAPSED); // prevent focus changing by "current tab attached to collapsed tree"
      promises.push(attachTabTo(tab, parent, Object.assign({}, aOptions, {
        dontExpand: true,
        dontMove:   true,
        justNow:    true
      })));
    }
  }
  if (promises.length > 0)
    await Promise.all(promises);
  MetricsData.add('applyTreeStructureToTabs: attach/detach');

  log('expandStates: ', expandStates);
  for (let i = aTabs.length-1; i > -1; i--) {
    let tab = aTabs[i];
    let expanded = expandStates[i];
    collapseExpandSubtree(tab, Object.assign({}, aOptions, {
      collapsed: expanded === undefined ? !TabInfo.hasChildTabs(tab) : !expanded ,
      justNow:   true,
      force:     true
    }));
  }
  MetricsData.add('applyTreeStructureToTabs: collapse/expand');
}


function openGroupBookmarkBehavior() {
  return Constants.kGROUP_BOOKMARK_SUBTREE | Constants.kGROUP_BOOKMARK_USE_DUMMY | Constants.kGROUP_BOOKMARK_EXPAND_ALL_TREE;
/*
  var behavior = utils.getTreePref('openGroupBookmark.behavior');
  if (behavior & this.Constants.kGROUP_BOOKMARK_FIXED)
    return behavior;

  var dummyTabFlag = behavior & this.Constants.kGROUP_BOOKMARK_USE_DUMMY;

  var checked = { value : false };
  var button = Services.prompt.confirmEx(this.browserWindow,
      utils.treeBundle.getString('openGroupBookmarkBehavior.title'),
      utils.treeBundle.getString('openGroupBookmarkBehavior.text'),
      // The "cancel" button must pe placed as the second button
      // due to the bug: https://bugzilla.mozilla.org/show_bug.cgi?id=345067
      (Services.prompt.BUTTON_TITLE_IS_STRING * Services.prompt.BUTTON_POS_0) |
      (Services.prompt.BUTTON_TITLE_CANCEL * Services.prompt.BUTTON_POS_1) |
      (Services.prompt.BUTTON_TITLE_IS_STRING * Services.prompt.BUTTON_POS_2),
      utils.treeBundle.getString('openGroupBookmarkBehavior.subTree'),
      '',
      utils.treeBundle.getString('openGroupBookmarkBehavior.separate'),
      utils.treeBundle.getString('openGroupBookmarkBehavior.never'),
      checked
    );

  if (button < 0)
    return this.Constants.kGROUP_BOOKMARK_CANCEL;

  var behaviors = [
      this.Constants.kGROUP_BOOKMARK_SUBTREE | dummyTabFlag,
      this.Constants.kGROUP_BOOKMARK_CANCEL,
      this.Constants.kGROUP_BOOKMARK_SEPARATE
    ];
  behavior = behaviors[button];

  if (checked.value && button != this.Constants.kGROUP_BOOKMARK_CANCEL) {
    utils.setTreePref('openGroupBookmark.behavior', behavior);
  }
  return behavior;
*/
}
