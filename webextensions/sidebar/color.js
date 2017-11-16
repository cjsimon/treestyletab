/*
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
*/
'use strict';

function mixCSSColors(aBase, aOver) {
  var base = parseCSSColor(aBase);
  var over = parseCSSColor(aOver);
  var mixed = mixColors(base, over);
  return `rgb(${mixed.red}, ${mixed.green}, ${mixed.blue})`;
}

function parseCSSColor(aColor, aBaseColor) {
  if (typeof aColor!= 'string')
    return aColor;

  var red, green, blue, alpha;

  // RRGGBB, RRGGBBAA
  var parts = aColor.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i);
  if (parts) {
    red   = parseInt(parts[1], 16);
    green = parseInt(parts[2], 16);
    blue  = parseInt(parts[3], 16);
    alpha = parts[4] ? parseInt(parts[4], 16) / 255 : 1 ;
  }
  if (!parts) {
    // RGB, RGBA
    parts = aColor.match(/^#?([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])?$/i);
    if (parts) {
      red   = Math.min(255, Math.round(255 * (parseInt(parts[1], 16) / 16)));
      green = Math.min(255, Math.round(255 * (parseInt(parts[2], 16) / 16)));
      blue  = Math.min(255, Math.round(255 * (parseInt(parts[3], 16) / 16)));
      alpha = parts[4] ? parseInt(parts[4], 16) / 16 : 1 ;
    }
  }
  if (!parts) {
    // rgb(), rgba()
    parts = aColor.match(/^rgba?\(\s*([0-9]+)\s*,\s*([0-9]+)\s*,\s*([0-9]+)(?:\s*,\s*((?:0\.)?[0-9]+)\s*)?\)$/i);
    if (!parts)
      return aColor;
    red   = parseInt(parts[1]);
    green = parseInt(parts[2]);
    blue  = parseInt(parts[3]);
    alpha = parts[4] ? parseFloat(parts[4]) : 1 ;
  }

  var parsed = { red, green, blue, alpha };

  if (alpha < 1 && aBaseColor)
    return mixColors(parseCSSColor(aBaseColor), parsed);

  return parsed;
}

function mixColors(aBase, aOver) {
  var alpha = aOver.alpha;
  var red   = Math.min(255, Math.round((aBase.red   * (1 - alpha)) + (aOver.red   * alpha)));
  var green = Math.min(255, Math.round((aBase.green * (1 - alpha)) + (aOver.green * alpha)));
  var blue  = Math.min(255, Math.round((aBase.blue  * (1 - alpha)) + (aOver.blue  * alpha)));
  return { red, green, blue, alpha: 1 };
}

function getReadableForegroundColorFromBGColor(aColor) { // expected input: 'RRGGBB', 'RGB', 'rgb(...)'
  var color = parseCSSColor(aColor);
  if (!color)
    return '-moz-fieldtext';
  var brightness = (color.red * 0.299 + color.green * 0.587 + color.blue * 0.114) / 255;
  return brightness < 0.5 ? 'white' : 'black';
}
