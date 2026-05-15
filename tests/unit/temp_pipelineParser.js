"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// ../../src/parsers/pipelineParser.ts
var pipelineParser_exports = {};
__export(pipelineParser_exports, {
  PipelineParser: () => PipelineParser
});
module.exports = __toCommonJS(pipelineParser_exports);

// ../../node_modules/js-yaml/dist/js-yaml.mjs
function isNothing(subject) {
  return typeof subject === "undefined" || subject === null;
}
function isObject(subject) {
  return typeof subject === "object" && subject !== null;
}
function toArray(sequence) {
  if (Array.isArray(sequence)) return sequence;
  else if (isNothing(sequence)) return [];
  return [sequence];
}
function extend(target, source) {
  var index, length, key, sourceKeys;
  if (source) {
    sourceKeys = Object.keys(source);
    for (index = 0, length = sourceKeys.length; index < length; index += 1) {
      key = sourceKeys[index];
      target[key] = source[key];
    }
  }
  return target;
}
function repeat(string, count) {
  var result = "", cycle;
  for (cycle = 0; cycle < count; cycle += 1) {
    result += string;
  }
  return result;
}
function isNegativeZero(number) {
  return number === 0 && Number.NEGATIVE_INFINITY === 1 / number;
}
var isNothing_1 = isNothing;
var isObject_1 = isObject;
var toArray_1 = toArray;
var repeat_1 = repeat;
var isNegativeZero_1 = isNegativeZero;
var extend_1 = extend;
var common = {
  isNothing: isNothing_1,
  isObject: isObject_1,
  toArray: toArray_1,
  repeat: repeat_1,
  isNegativeZero: isNegativeZero_1,
  extend: extend_1
};
function formatError(exception2, compact) {
  var where = "", message = exception2.reason || "(unknown reason)";
  if (!exception2.mark) return message;
  if (exception2.mark.name) {
    where += 'in "' + exception2.mark.name + '" ';
  }
  where += "(" + (exception2.mark.line + 1) + ":" + (exception2.mark.column + 1) + ")";
  if (!compact && exception2.mark.snippet) {
    where += "\n\n" + exception2.mark.snippet;
  }
  return message + " " + where;
}
function YAMLException$1(reason, mark) {
  Error.call(this);
  this.name = "YAMLException";
  this.reason = reason;
  this.mark = mark;
  this.message = formatError(this, false);
  if (Error.captureStackTrace) {
    Error.captureStackTrace(this, this.constructor);
  } else {
    this.stack = new Error().stack || "";
  }
}
YAMLException$1.prototype = Object.create(Error.prototype);
YAMLException$1.prototype.constructor = YAMLException$1;
YAMLException$1.prototype.toString = function toString(compact) {
  return this.name + ": " + formatError(this, compact);
};
var exception = YAMLException$1;
function getLine(buffer, lineStart, lineEnd, position, maxLineLength) {
  var head = "";
  var tail = "";
  var maxHalfLength = Math.floor(maxLineLength / 2) - 1;
  if (position - lineStart > maxHalfLength) {
    head = " ... ";
    lineStart = position - maxHalfLength + head.length;
  }
  if (lineEnd - position > maxHalfLength) {
    tail = " ...";
    lineEnd = position + maxHalfLength - tail.length;
  }
  return {
    str: head + buffer.slice(lineStart, lineEnd).replace(/\t/g, "\u2192") + tail,
    pos: position - lineStart + head.length
    // relative position
  };
}
function padStart(string, max) {
  return common.repeat(" ", max - string.length) + string;
}
function makeSnippet(mark, options) {
  options = Object.create(options || null);
  if (!mark.buffer) return null;
  if (!options.maxLength) options.maxLength = 79;
  if (typeof options.indent !== "number") options.indent = 1;
  if (typeof options.linesBefore !== "number") options.linesBefore = 3;
  if (typeof options.linesAfter !== "number") options.linesAfter = 2;
  var re = /\r?\n|\r|\0/g;
  var lineStarts = [0];
  var lineEnds = [];
  var match;
  var foundLineNo = -1;
  while (match = re.exec(mark.buffer)) {
    lineEnds.push(match.index);
    lineStarts.push(match.index + match[0].length);
    if (mark.position <= match.index && foundLineNo < 0) {
      foundLineNo = lineStarts.length - 2;
    }
  }
  if (foundLineNo < 0) foundLineNo = lineStarts.length - 1;
  var result = "", i, line;
  var lineNoLength = Math.min(mark.line + options.linesAfter, lineEnds.length).toString().length;
  var maxLineLength = options.maxLength - (options.indent + lineNoLength + 3);
  for (i = 1; i <= options.linesBefore; i++) {
    if (foundLineNo - i < 0) break;
    line = getLine(
      mark.buffer,
      lineStarts[foundLineNo - i],
      lineEnds[foundLineNo - i],
      mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo - i]),
      maxLineLength
    );
    result = common.repeat(" ", options.indent) + padStart((mark.line - i + 1).toString(), lineNoLength) + " | " + line.str + "\n" + result;
  }
  line = getLine(mark.buffer, lineStarts[foundLineNo], lineEnds[foundLineNo], mark.position, maxLineLength);
  result += common.repeat(" ", options.indent) + padStart((mark.line + 1).toString(), lineNoLength) + " | " + line.str + "\n";
  result += common.repeat("-", options.indent + lineNoLength + 3 + line.pos) + "^\n";
  for (i = 1; i <= options.linesAfter; i++) {
    if (foundLineNo + i >= lineEnds.length) break;
    line = getLine(
      mark.buffer,
      lineStarts[foundLineNo + i],
      lineEnds[foundLineNo + i],
      mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo + i]),
      maxLineLength
    );
    result += common.repeat(" ", options.indent) + padStart((mark.line + i + 1).toString(), lineNoLength) + " | " + line.str + "\n";
  }
  return result.replace(/\n$/, "");
}
var snippet = makeSnippet;
var TYPE_CONSTRUCTOR_OPTIONS = [
  "kind",
  "multi",
  "resolve",
  "construct",
  "instanceOf",
  "predicate",
  "represent",
  "representName",
  "defaultStyle",
  "styleAliases"
];
var YAML_NODE_KINDS = [
  "scalar",
  "sequence",
  "mapping"
];
function compileStyleAliases(map2) {
  var result = {};
  if (map2 !== null) {
    Object.keys(map2).forEach(function (style) {
      map2[style].forEach(function (alias) {
        result[String(alias)] = style;
      });
    });
  }
  return result;
}
function Type$1(tag, options) {
  options = options || {};
  Object.keys(options).forEach(function (name) {
    if (TYPE_CONSTRUCTOR_OPTIONS.indexOf(name) === -1) {
      throw new exception('Unknown option "' + name + '" is met in definition of "' + tag + '" YAML type.');
    }
  });
  this.options = options;
  this.tag = tag;
  this.kind = options["kind"] || null;
  this.resolve = options["resolve"] || function () {
    return true;
  };
  this.construct = options["construct"] || function (data) {
    return data;
  };
  this.instanceOf = options["instanceOf"] || null;
  this.predicate = options["predicate"] || null;
  this.represent = options["represent"] || null;
  this.representName = options["representName"] || null;
  this.defaultStyle = options["defaultStyle"] || null;
  this.multi = options["multi"] || false;
  this.styleAliases = compileStyleAliases(options["styleAliases"] || null);
  if (YAML_NODE_KINDS.indexOf(this.kind) === -1) {
    throw new exception('Unknown kind "' + this.kind + '" is specified for "' + tag + '" YAML type.');
  }
}
var type = Type$1;
function compileList(schema2, name) {
  var result = [];
  schema2[name].forEach(function (currentType) {
    var newIndex = result.length;
    result.forEach(function (previousType, previousIndex) {
      if (previousType.tag === currentType.tag && previousType.kind === currentType.kind && previousType.multi === currentType.multi) {
        newIndex = previousIndex;
      }
    });
    result[newIndex] = currentType;
  });
  return result;
}
function compileMap() {
  var result = {
    scalar: {},
    sequence: {},
    mapping: {},
    fallback: {},
    multi: {
      scalar: [],
      sequence: [],
      mapping: [],
      fallback: []
    }
  }, index, length;
  function collectType(type2) {
    if (type2.multi) {
      result.multi[type2.kind].push(type2);
      result.multi["fallback"].push(type2);
    } else {
      result[type2.kind][type2.tag] = result["fallback"][type2.tag] = type2;
    }
  }
  for (index = 0, length = arguments.length; index < length; index += 1) {
    arguments[index].forEach(collectType);
  }
  return result;
}
function Schema$1(definition) {
  return this.extend(definition);
}
Schema$1.prototype.extend = function extend2(definition) {
  var implicit = [];
  var explicit = [];
  if (definition instanceof type) {
    explicit.push(definition);
  } else if (Array.isArray(definition)) {
    explicit = explicit.concat(definition);
  } else if (definition && (Array.isArray(definition.implicit) || Array.isArray(definition.explicit))) {
    if (definition.implicit) implicit = implicit.concat(definition.implicit);
    if (definition.explicit) explicit = explicit.concat(definition.explicit);
  } else {
    throw new exception("Schema.extend argument should be a Type, [ Type ], or a schema definition ({ implicit: [...], explicit: [...] })");
  }
  implicit.forEach(function (type$1) {
    if (!(type$1 instanceof type)) {
      throw new exception("Specified list of YAML types (or a single Type object) contains a non-Type object.");
    }
    if (type$1.loadKind && type$1.loadKind !== "scalar") {
      throw new exception("There is a non-scalar type in the implicit list of a schema. Implicit resolving of such types is not supported.");
    }
    if (type$1.multi) {
      throw new exception("There is a multi type in the implicit list of a schema. Multi tags can only be listed as explicit.");
    }
  });
  explicit.forEach(function (type$1) {
    if (!(type$1 instanceof type)) {
      throw new exception("Specified list of YAML types (or a single Type object) contains a non-Type object.");
    }
  });
  var result = Object.create(Schema$1.prototype);
  result.implicit = (this.implicit || []).concat(implicit);
  result.explicit = (this.explicit || []).concat(explicit);
  result.compiledImplicit = compileList(result, "implicit");
  result.compiledExplicit = compileList(result, "explicit");
  result.compiledTypeMap = compileMap(result.compiledImplicit, result.compiledExplicit);
  return result;
};
var schema = Schema$1;
var str = new type("tag:yaml.org,2002:str", {
  kind: "scalar",
  construct: function (data) {
    return data !== null ? data : "";
  }
});
var seq = new type("tag:yaml.org,2002:seq", {
  kind: "sequence",
  construct: function (data) {
    return data !== null ? data : [];
  }
});
var map = new type("tag:yaml.org,2002:map", {
  kind: "mapping",
  construct: function (data) {
    return data !== null ? data : {};
  }
});
var failsafe = new schema({
  explicit: [
    str,
    seq,
    map
  ]
});
function resolveYamlNull(data) {
  if (data === null) return true;
  var max = data.length;
  return max === 1 && data === "~" || max === 4 && (data === "null" || data === "Null" || data === "NULL");
}
function constructYamlNull() {
  return null;
}
function isNull(object) {
  return object === null;
}
var _null = new type("tag:yaml.org,2002:null", {
  kind: "scalar",
  resolve: resolveYamlNull,
  construct: constructYamlNull,
  predicate: isNull,
  represent: {
    canonical: function () {
      return "~";
    },
    lowercase: function () {
      return "null";
    },
    uppercase: function () {
      return "NULL";
    },
    camelcase: function () {
      return "Null";
    },
    empty: function () {
      return "";
    }
  },
  defaultStyle: "lowercase"
});
function resolveYamlBoolean(data) {
  if (data === null) return false;
  var max = data.length;
  return max === 4 && (data === "true" || data === "True" || data === "TRUE") || max === 5 && (data === "false" || data === "False" || data === "FALSE");
}
function constructYamlBoolean(data) {
  return data === "true" || data === "True" || data === "TRUE";
}
function isBoolean(object) {
  return Object.prototype.toString.call(object) === "[object Boolean]";
}
var bool = new type("tag:yaml.org,2002:bool", {
  kind: "scalar",
  resolve: resolveYamlBoolean,
  construct: constructYamlBoolean,
  predicate: isBoolean,
  represent: {
    lowercase: function (object) {
      return object ? "true" : "false";
    },
    uppercase: function (object) {
      return object ? "TRUE" : "FALSE";
    },
    camelcase: function (object) {
      return object ? "True" : "False";
    }
  },
  defaultStyle: "lowercase"
});
function isHexCode(c) {
  return 48 <= c && c <= 57 || 65 <= c && c <= 70 || 97 <= c && c <= 102;
}
function isOctCode(c) {
  return 48 <= c && c <= 55;
}
function isDecCode(c) {
  return 48 <= c && c <= 57;
}
function resolveYamlInteger(data) {
  if (data === null) return false;
  var max = data.length, index = 0, hasDigits = false, ch;
  if (!max) return false;
  ch = data[index];
  if (ch === "-" || ch === "+") {
    ch = data[++index];
  }
  if (ch === "0") {
    if (index + 1 === max) return true;
    ch = data[++index];
    if (ch === "b") {
      index++;
      for (; index < max; index++) {
        ch = data[index];
        if (ch === "_") continue;
        if (ch !== "0" && ch !== "1") return false;
        hasDigits = true;
      }
      return hasDigits && ch !== "_";
    }
    if (ch === "x") {
      index++;
      for (; index < max; index++) {
        ch = data[index];
        if (ch === "_") continue;
        if (!isHexCode(data.charCodeAt(index))) return false;
        hasDigits = true;
      }
      return hasDigits && ch !== "_";
    }
    if (ch === "o") {
      index++;
      for (; index < max; index++) {
        ch = data[index];
        if (ch === "_") continue;
        if (!isOctCode(data.charCodeAt(index))) return false;
        hasDigits = true;
      }
      return hasDigits && ch !== "_";
    }
  }
  if (ch === "_") return false;
  for (; index < max; index++) {
    ch = data[index];
    if (ch === "_") continue;
    if (!isDecCode(data.charCodeAt(index))) {
      return false;
    }
    hasDigits = true;
  }
  if (!hasDigits || ch === "_") return false;
  return true;
}
function constructYamlInteger(data) {
  var value = data, sign = 1, ch;
  if (value.indexOf("_") !== -1) {
    value = value.replace(/_/g, "");
  }
  ch = value[0];
  if (ch === "-" || ch === "+") {
    if (ch === "-") sign = -1;
    value = value.slice(1);
    ch = value[0];
  }
  if (value === "0") return 0;
  if (ch === "0") {
    if (value[1] === "b") return sign * parseInt(value.slice(2), 2);
    if (value[1] === "x") return sign * parseInt(value.slice(2), 16);
    if (value[1] === "o") return sign * parseInt(value.slice(2), 8);
  }
  return sign * parseInt(value, 10);
}
function isInteger(object) {
  return Object.prototype.toString.call(object) === "[object Number]" && (object % 1 === 0 && !common.isNegativeZero(object));
}
var int = new type("tag:yaml.org,2002:int", {
  kind: "scalar",
  resolve: resolveYamlInteger,
  construct: constructYamlInteger,
  predicate: isInteger,
  represent: {
    binary: function (obj) {
      return obj >= 0 ? "0b" + obj.toString(2) : "-0b" + obj.toString(2).slice(1);
    },
    octal: function (obj) {
      return obj >= 0 ? "0o" + obj.toString(8) : "-0o" + obj.toString(8).slice(1);
    },
    decimal: function (obj) {
      return obj.toString(10);
    },
    /* eslint-disable max-len */
    hexadecimal: function (obj) {
      return obj >= 0 ? "0x" + obj.toString(16).toUpperCase() : "-0x" + obj.toString(16).toUpperCase().slice(1);
    }
  },
  defaultStyle: "decimal",
  styleAliases: {
    binary: [2, "bin"],
    octal: [8, "oct"],
    decimal: [10, "dec"],
    hexadecimal: [16, "hex"]
  }
});
var YAML_FLOAT_PATTERN = new RegExp(
  // 2.5e4, 2.5 and integers
  "^(?:[-+]?(?:[0-9][0-9_]*)(?:\\.[0-9_]*)?(?:[eE][-+]?[0-9]+)?|\\.[0-9_]+(?:[eE][-+]?[0-9]+)?|[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$"
);
function resolveYamlFloat(data) {
  if (data === null) return false;
  if (!YAML_FLOAT_PATTERN.test(data) || // Quick hack to not allow integers end with `_`
    // Probably should update regexp & check speed
    data[data.length - 1] === "_") {
    return false;
  }
  return true;
}
function constructYamlFloat(data) {
  var value, sign;
  value = data.replace(/_/g, "").toLowerCase();
  sign = value[0] === "-" ? -1 : 1;
  if ("+-".indexOf(value[0]) >= 0) {
    value = value.slice(1);
  }
  if (value === ".inf") {
    return sign === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  } else if (value === ".nan") {
    return NaN;
  }
  return sign * parseFloat(value, 10);
}
var SCIENTIFIC_WITHOUT_DOT = /^[-+]?[0-9]+e/;
function representYamlFloat(object, style) {
  var res;
  if (isNaN(object)) {
    switch (style) {
      case "lowercase":
        return ".nan";
      case "uppercase":
        return ".NAN";
      case "camelcase":
        return ".NaN";
    }
  } else if (Number.POSITIVE_INFINITY === object) {
    switch (style) {
      case "lowercase":
        return ".inf";
      case "uppercase":
        return ".INF";
      case "camelcase":
        return ".Inf";
    }
  } else if (Number.NEGATIVE_INFINITY === object) {
    switch (style) {
      case "lowercase":
        return "-.inf";
      case "uppercase":
        return "-.INF";
      case "camelcase":
        return "-.Inf";
    }
  } else if (common.isNegativeZero(object)) {
    return "-0.0";
  }
  res = object.toString(10);
  return SCIENTIFIC_WITHOUT_DOT.test(res) ? res.replace("e", ".e") : res;
}
function isFloat(object) {
  return Object.prototype.toString.call(object) === "[object Number]" && (object % 1 !== 0 || common.isNegativeZero(object));
}
var float = new type("tag:yaml.org,2002:float", {
  kind: "scalar",
  resolve: resolveYamlFloat,
  construct: constructYamlFloat,
  predicate: isFloat,
  represent: representYamlFloat,
  defaultStyle: "lowercase"
});
var json = failsafe.extend({
  implicit: [
    _null,
    bool,
    int,
    float
  ]
});
var core = json;
var YAML_DATE_REGEXP = new RegExp(
  "^([0-9][0-9][0-9][0-9])-([0-9][0-9])-([0-9][0-9])$"
);
var YAML_TIMESTAMP_REGEXP = new RegExp(
  "^([0-9][0-9][0-9][0-9])-([0-9][0-9]?)-([0-9][0-9]?)(?:[Tt]|[ \\t]+)([0-9][0-9]?):([0-9][0-9]):([0-9][0-9])(?:\\.([0-9]*))?(?:[ \\t]*(Z|([-+])([0-9][0-9]?)(?::([0-9][0-9]))?))?$"
);
function resolveYamlTimestamp(data) {
  if (data === null) return false;
  if (YAML_DATE_REGEXP.exec(data) !== null) return true;
  if (YAML_TIMESTAMP_REGEXP.exec(data) !== null) return true;
  return false;
}
function constructYamlTimestamp(data) {
  var match, year, month, day, hour, minute, second, fraction = 0, delta = null, tz_hour, tz_minute, date;
  match = YAML_DATE_REGEXP.exec(data);
  if (match === null) match = YAML_TIMESTAMP_REGEXP.exec(data);
  if (match === null) throw new Error("Date resolve error");
  year = +match[1];
  month = +match[2] - 1;
  day = +match[3];
  if (!match[4]) {
    return new Date(Date.UTC(year, month, day));
  }
  hour = +match[4];
  minute = +match[5];
  second = +match[6];
  if (match[7]) {
    fraction = match[7].slice(0, 3);
    while (fraction.length < 3) {
      fraction += "0";
    }
    fraction = +fraction;
  }
  if (match[9]) {
    tz_hour = +match[10];
    tz_minute = +(match[11] || 0);
    delta = (tz_hour * 60 + tz_minute) * 6e4;
    if (match[9] === "-") delta = -delta;
  }
  date = new Date(Date.UTC(year, month, day, hour, minute, second, fraction));
  if (delta) date.setTime(date.getTime() - delta);
  return date;
}
function representYamlTimestamp(object) {
  return object.toISOString();
}
var timestamp = new type("tag:yaml.org,2002:timestamp", {
  kind: "scalar",
  resolve: resolveYamlTimestamp,
  construct: constructYamlTimestamp,
  instanceOf: Date,
  represent: representYamlTimestamp
});
function resolveYamlMerge(data) {
  return data === "<<" || data === null;
}
var merge = new type("tag:yaml.org,2002:merge", {
  kind: "scalar",
  resolve: resolveYamlMerge
});
var BASE64_MAP = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=\n\r";
function resolveYamlBinary(data) {
  if (data === null) return false;
  var code, idx, bitlen = 0, max = data.length, map2 = BASE64_MAP;
  for (idx = 0; idx < max; idx++) {
    code = map2.indexOf(data.charAt(idx));
    if (code > 64) continue;
    if (code < 0) return false;
    bitlen += 6;
  }
  return bitlen % 8 === 0;
}
function constructYamlBinary(data) {
  var idx, tailbits, input = data.replace(/[\r\n=]/g, ""), max = input.length, map2 = BASE64_MAP, bits = 0, result = [];
  for (idx = 0; idx < max; idx++) {
    if (idx % 4 === 0 && idx) {
      result.push(bits >> 16 & 255);
      result.push(bits >> 8 & 255);
      result.push(bits & 255);
    }
    bits = bits << 6 | map2.indexOf(input.charAt(idx));
  }
  tailbits = max % 4 * 6;
  if (tailbits === 0) {
    result.push(bits >> 16 & 255);
    result.push(bits >> 8 & 255);
    result.push(bits & 255);
  } else if (tailbits === 18) {
    result.push(bits >> 10 & 255);
    result.push(bits >> 2 & 255);
  } else if (tailbits === 12) {
    result.push(bits >> 4 & 255);
  }
  return new Uint8Array(result);
}
function representYamlBinary(object) {
  var result = "", bits = 0, idx, tail, max = object.length, map2 = BASE64_MAP;
  for (idx = 0; idx < max; idx++) {
    if (idx % 3 === 0 && idx) {
      result += map2[bits >> 18 & 63];
      result += map2[bits >> 12 & 63];
      result += map2[bits >> 6 & 63];
      result += map2[bits & 63];
    }
    bits = (bits << 8) + object[idx];
  }
  tail = max % 3;
  if (tail === 0) {
    result += map2[bits >> 18 & 63];
    result += map2[bits >> 12 & 63];
    result += map2[bits >> 6 & 63];
    result += map2[bits & 63];
  } else if (tail === 2) {
    result += map2[bits >> 10 & 63];
    result += map2[bits >> 4 & 63];
    result += map2[bits << 2 & 63];
    result += map2[64];
  } else if (tail === 1) {
    result += map2[bits >> 2 & 63];
    result += map2[bits << 4 & 63];
    result += map2[64];
    result += map2[64];
  }
  return result;
}
function isBinary(obj) {
  return Object.prototype.toString.call(obj) === "[object Uint8Array]";
}
var binary = new type("tag:yaml.org,2002:binary", {
  kind: "scalar",
  resolve: resolveYamlBinary,
  construct: constructYamlBinary,
  predicate: isBinary,
  represent: representYamlBinary
});
var _hasOwnProperty$3 = Object.prototype.hasOwnProperty;
var _toString$2 = Object.prototype.toString;
function resolveYamlOmap(data) {
  if (data === null) return true;
  var objectKeys = [], index, length, pair, pairKey, pairHasKey, object = data;
  for (index = 0, length = object.length; index < length; index += 1) {
    pair = object[index];
    pairHasKey = false;
    if (_toString$2.call(pair) !== "[object Object]") return false;
    for (pairKey in pair) {
      if (_hasOwnProperty$3.call(pair, pairKey)) {
        if (!pairHasKey) pairHasKey = true;
        else return false;
      }
    }
    if (!pairHasKey) return false;
    if (objectKeys.indexOf(pairKey) === -1) objectKeys.push(pairKey);
    else return false;
  }
  return true;
}
function constructYamlOmap(data) {
  return data !== null ? data : [];
}
var omap = new type("tag:yaml.org,2002:omap", {
  kind: "sequence",
  resolve: resolveYamlOmap,
  construct: constructYamlOmap
});
var _toString$1 = Object.prototype.toString;
function resolveYamlPairs(data) {
  if (data === null) return true;
  var index, length, pair, keys, result, object = data;
  result = new Array(object.length);
  for (index = 0, length = object.length; index < length; index += 1) {
    pair = object[index];
    if (_toString$1.call(pair) !== "[object Object]") return false;
    keys = Object.keys(pair);
    if (keys.length !== 1) return false;
    result[index] = [keys[0], pair[keys[0]]];
  }
  return true;
}
function constructYamlPairs(data) {
  if (data === null) return [];
  var index, length, pair, keys, result, object = data;
  result = new Array(object.length);
  for (index = 0, length = object.length; index < length; index += 1) {
    pair = object[index];
    keys = Object.keys(pair);
    result[index] = [keys[0], pair[keys[0]]];
  }
  return result;
}
var pairs = new type("tag:yaml.org,2002:pairs", {
  kind: "sequence",
  resolve: resolveYamlPairs,
  construct: constructYamlPairs
});
var _hasOwnProperty$2 = Object.prototype.hasOwnProperty;
function resolveYamlSet(data) {
  if (data === null) return true;
  var key, object = data;
  for (key in object) {
    if (_hasOwnProperty$2.call(object, key)) {
      if (object[key] !== null) return false;
    }
  }
  return true;
}
function constructYamlSet(data) {
  return data !== null ? data : {};
}
var set = new type("tag:yaml.org,2002:set", {
  kind: "mapping",
  resolve: resolveYamlSet,
  construct: constructYamlSet
});
var _default = core.extend({
  implicit: [
    timestamp,
    merge
  ],
  explicit: [
    binary,
    omap,
    pairs,
    set
  ]
});
var _hasOwnProperty$1 = Object.prototype.hasOwnProperty;
var CONTEXT_FLOW_IN = 1;
var CONTEXT_FLOW_OUT = 2;
var CONTEXT_BLOCK_IN = 3;
var CONTEXT_BLOCK_OUT = 4;
var CHOMPING_CLIP = 1;
var CHOMPING_STRIP = 2;
var CHOMPING_KEEP = 3;
var PATTERN_NON_PRINTABLE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/;
var PATTERN_NON_ASCII_LINE_BREAKS = /[\x85\u2028\u2029]/;
var PATTERN_FLOW_INDICATORS = /[,\[\]\{\}]/;
var PATTERN_TAG_HANDLE = /^(?:!|!!|![a-z\-]+!)$/i;
var PATTERN_TAG_URI = /^(?:!|[^,\[\]\{\}])(?:%[0-9a-f]{2}|[0-9a-z\-#;\/\?:@&=\+\$,_\.!~\*'\(\)\[\]])*$/i;
function _class(obj) {
  return Object.prototype.toString.call(obj);
}
function is_EOL(c) {
  return c === 10 || c === 13;
}
function is_WHITE_SPACE(c) {
  return c === 9 || c === 32;
}
function is_WS_OR_EOL(c) {
  return c === 9 || c === 32 || c === 10 || c === 13;
}
function is_FLOW_INDICATOR(c) {
  return c === 44 || c === 91 || c === 93 || c === 123 || c === 125;
}
function fromHexCode(c) {
  var lc;
  if (48 <= c && c <= 57) {
    return c - 48;
  }
  lc = c | 32;
  if (97 <= lc && lc <= 102) {
    return lc - 97 + 10;
  }
  return -1;
}
function escapedHexLen(c) {
  if (c === 120) {
    return 2;
  }
  if (c === 117) {
    return 4;
  }
  if (c === 85) {
    return 8;
  }
  return 0;
}
function fromDecimalCode(c) {
  if (48 <= c && c <= 57) {
    return c - 48;
  }
  return -1;
}
function simpleEscapeSequence(c) {
  return c === 48 ? "\0" : c === 97 ? "\x07" : c === 98 ? "\b" : c === 116 ? "	" : c === 9 ? "	" : c === 110 ? "\n" : c === 118 ? "\v" : c === 102 ? "\f" : c === 114 ? "\r" : c === 101 ? "\x1B" : c === 32 ? " " : c === 34 ? '"' : c === 47 ? "/" : c === 92 ? "\\" : c === 78 ? "\x85" : c === 95 ? "\xA0" : c === 76 ? "\u2028" : c === 80 ? "\u2029" : "";
}
function charFromCodepoint(c) {
  if (c <= 65535) {
    return String.fromCharCode(c);
  }
  return String.fromCharCode(
    (c - 65536 >> 10) + 55296,
    (c - 65536 & 1023) + 56320
  );
}
function setProperty(object, key, value) {
  if (key === "__proto__") {
    Object.defineProperty(object, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value
    });
  } else {
    object[key] = value;
  }
}
var simpleEscapeCheck = new Array(256);
var simpleEscapeMap = new Array(256);
for (i = 0; i < 256; i++) {
  simpleEscapeCheck[i] = simpleEscapeSequence(i) ? 1 : 0;
  simpleEscapeMap[i] = simpleEscapeSequence(i);
}
var i;
function State$1(input, options) {
  this.input = input;
  this.filename = options["filename"] || null;
  this.schema = options["schema"] || _default;
  this.onWarning = options["onWarning"] || null;
  this.legacy = options["legacy"] || false;
  this.json = options["json"] || false;
  this.listener = options["listener"] || null;
  this.implicitTypes = this.schema.compiledImplicit;
  this.typeMap = this.schema.compiledTypeMap;
  this.length = input.length;
  this.position = 0;
  this.line = 0;
  this.lineStart = 0;
  this.lineIndent = 0;
  this.firstTabInLine = -1;
  this.documents = [];
}
function generateError(state, message) {
  var mark = {
    name: state.filename,
    buffer: state.input.slice(0, -1),
    // omit trailing \0
    position: state.position,
    line: state.line,
    column: state.position - state.lineStart
  };
  mark.snippet = snippet(mark);
  return new exception(message, mark);
}
function throwError(state, message) {
  throw generateError(state, message);
}
function throwWarning(state, message) {
  if (state.onWarning) {
    state.onWarning.call(null, generateError(state, message));
  }
}
var directiveHandlers = {
  YAML: function handleYamlDirective(state, name, args) {
    var match, major, minor;
    if (state.version !== null) {
      throwError(state, "duplication of %YAML directive");
    }
    if (args.length !== 1) {
      throwError(state, "YAML directive accepts exactly one argument");
    }
    match = /^([0-9]+)\.([0-9]+)$/.exec(args[0]);
    if (match === null) {
      throwError(state, "ill-formed argument of the YAML directive");
    }
    major = parseInt(match[1], 10);
    minor = parseInt(match[2], 10);
    if (major !== 1) {
      throwError(state, "unacceptable YAML version of the document");
    }
    state.version = args[0];
    state.checkLineBreaks = minor < 2;
    if (minor !== 1 && minor !== 2) {
      throwWarning(state, "unsupported YAML version of the document");
    }
  },
  TAG: function handleTagDirective(state, name, args) {
    var handle, prefix;
    if (args.length !== 2) {
      throwError(state, "TAG directive accepts exactly two arguments");
    }
    handle = args[0];
    prefix = args[1];
    if (!PATTERN_TAG_HANDLE.test(handle)) {
      throwError(state, "ill-formed tag handle (first argument) of the TAG directive");
    }
    if (_hasOwnProperty$1.call(state.tagMap, handle)) {
      throwError(state, 'there is a previously declared suffix for "' + handle + '" tag handle');
    }
    if (!PATTERN_TAG_URI.test(prefix)) {
      throwError(state, "ill-formed tag prefix (second argument) of the TAG directive");
    }
    try {
      prefix = decodeURIComponent(prefix);
    } catch (err) {
      throwError(state, "tag prefix is malformed: " + prefix);
    }
    state.tagMap[handle] = prefix;
  }
};
function captureSegment(state, start, end, checkJson) {
  var _position, _length, _character, _result;
  if (start < end) {
    _result = state.input.slice(start, end);
    if (checkJson) {
      for (_position = 0, _length = _result.length; _position < _length; _position += 1) {
        _character = _result.charCodeAt(_position);
        if (!(_character === 9 || 32 <= _character && _character <= 1114111)) {
          throwError(state, "expected valid JSON character");
        }
      }
    } else if (PATTERN_NON_PRINTABLE.test(_result)) {
      throwError(state, "the stream contains non-printable characters");
    }
    state.result += _result;
  }
}
function mergeMappings(state, destination, source, overridableKeys) {
  var sourceKeys, key, index, quantity;
  if (!common.isObject(source)) {
    throwError(state, "cannot merge mappings; the provided source object is unacceptable");
  }
  sourceKeys = Object.keys(source);
  for (index = 0, quantity = sourceKeys.length; index < quantity; index += 1) {
    key = sourceKeys[index];
    if (!_hasOwnProperty$1.call(destination, key)) {
      setProperty(destination, key, source[key]);
      overridableKeys[key] = true;
    }
  }
}
function storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, startLine, startLineStart, startPos) {
  var index, quantity;
  if (Array.isArray(keyNode)) {
    keyNode = Array.prototype.slice.call(keyNode);
    for (index = 0, quantity = keyNode.length; index < quantity; index += 1) {
      if (Array.isArray(keyNode[index])) {
        throwError(state, "nested arrays are not supported inside keys");
      }
      if (typeof keyNode === "object" && _class(keyNode[index]) === "[object Object]") {
        keyNode[index] = "[object Object]";
      }
    }
  }
  if (typeof keyNode === "object" && _class(keyNode) === "[object Object]") {
    keyNode = "[object Object]";
  }
  keyNode = String(keyNode);
  if (_result === null) {
    _result = {};
  }
  if (keyTag === "tag:yaml.org,2002:merge") {
    if (Array.isArray(valueNode)) {
      for (index = 0, quantity = valueNode.length; index < quantity; index += 1) {
        mergeMappings(state, _result, valueNode[index], overridableKeys);
      }
    } else {
      mergeMappings(state, _result, valueNode, overridableKeys);
    }
  } else {
    if (!state.json && !_hasOwnProperty$1.call(overridableKeys, keyNode) && _hasOwnProperty$1.call(_result, keyNode)) {
      state.line = startLine || state.line;
      state.lineStart = startLineStart || state.lineStart;
      state.position = startPos || state.position;
      throwError(state, "duplicated mapping key");
    }
    setProperty(_result, keyNode, valueNode);
    delete overridableKeys[keyNode];
  }
  return _result;
}
function readLineBreak(state) {
  var ch;
  ch = state.input.charCodeAt(state.position);
  if (ch === 10) {
    state.position++;
  } else if (ch === 13) {
    state.position++;
    if (state.input.charCodeAt(state.position) === 10) {
      state.position++;
    }
  } else {
    throwError(state, "a line break is expected");
  }
  state.line += 1;
  state.lineStart = state.position;
  state.firstTabInLine = -1;
}
function skipSeparationSpace(state, allowComments, checkIndent) {
  var lineBreaks = 0, ch = state.input.charCodeAt(state.position);
  while (ch !== 0) {
    while (is_WHITE_SPACE(ch)) {
      if (ch === 9 && state.firstTabInLine === -1) {
        state.firstTabInLine = state.position;
      }
      ch = state.input.charCodeAt(++state.position);
    }
    if (allowComments && ch === 35) {
      do {
        ch = state.input.charCodeAt(++state.position);
      } while (ch !== 10 && ch !== 13 && ch !== 0);
    }
    if (is_EOL(ch)) {
      readLineBreak(state);
      ch = state.input.charCodeAt(state.position);
      lineBreaks++;
      state.lineIndent = 0;
      while (ch === 32) {
        state.lineIndent++;
        ch = state.input.charCodeAt(++state.position);
      }
    } else {
      break;
    }
  }
  if (checkIndent !== -1 && lineBreaks !== 0 && state.lineIndent < checkIndent) {
    throwWarning(state, "deficient indentation");
  }
  return lineBreaks;
}
function testDocumentSeparator(state) {
  var _position = state.position, ch;
  ch = state.input.charCodeAt(_position);
  if ((ch === 45 || ch === 46) && ch === state.input.charCodeAt(_position + 1) && ch === state.input.charCodeAt(_position + 2)) {
    _position += 3;
    ch = state.input.charCodeAt(_position);
    if (ch === 0 || is_WS_OR_EOL(ch)) {
      return true;
    }
  }
  return false;
}
function writeFoldedLines(state, count) {
  if (count === 1) {
    state.result += " ";
  } else if (count > 1) {
    state.result += common.repeat("\n", count - 1);
  }
}
function readPlainScalar(state, nodeIndent, withinFlowCollection) {
  var preceding, following, captureStart, captureEnd, hasPendingContent, _line, _lineStart, _lineIndent, _kind = state.kind, _result = state.result, ch;
  ch = state.input.charCodeAt(state.position);
  if (is_WS_OR_EOL(ch) || is_FLOW_INDICATOR(ch) || ch === 35 || ch === 38 || ch === 42 || ch === 33 || ch === 124 || ch === 62 || ch === 39 || ch === 34 || ch === 37 || ch === 64 || ch === 96) {
    return false;
  }
  if (ch === 63 || ch === 45) {
    following = state.input.charCodeAt(state.position + 1);
    if (is_WS_OR_EOL(following) || withinFlowCollection && is_FLOW_INDICATOR(following)) {
      return false;
    }
  }
  state.kind = "scalar";
  state.result = "";
  captureStart = captureEnd = state.position;
  hasPendingContent = false;
  while (ch !== 0) {
    if (ch === 58) {
      following = state.input.charCodeAt(state.position + 1);
      if (is_WS_OR_EOL(following) || withinFlowCollection && is_FLOW_INDICATOR(following)) {
        break;
      }
    } else if (ch === 35) {
      preceding = state.input.charCodeAt(state.position - 1);
      if (is_WS_OR_EOL(preceding)) {
        break;
      }
    } else if (state.position === state.lineStart && testDocumentSeparator(state) || withinFlowCollection && is_FLOW_INDICATOR(ch)) {
      break;
    } else if (is_EOL(ch)) {
      _line = state.line;
      _lineStart = state.lineStart;
      _lineIndent = state.lineIndent;
      skipSeparationSpace(state, false, -1);
      if (state.lineIndent >= nodeIndent) {
        hasPendingContent = true;
        ch = state.input.charCodeAt(state.position);
        continue;
      } else {
        state.position = captureEnd;
        state.line = _line;
        state.lineStart = _lineStart;
        state.lineIndent = _lineIndent;
        break;
      }
    }
    if (hasPendingContent) {
      captureSegment(state, captureStart, captureEnd, false);
      writeFoldedLines(state, state.line - _line);
      captureStart = captureEnd = state.position;
      hasPendingContent = false;
    }
    if (!is_WHITE_SPACE(ch)) {
      captureEnd = state.position + 1;
    }
    ch = state.input.charCodeAt(++state.position);
  }
  captureSegment(state, captureStart, captureEnd, false);
  if (state.result) {
    return true;
  }
  state.kind = _kind;
  state.result = _result;
  return false;
}
function readSingleQuotedScalar(state, nodeIndent) {
  var ch, captureStart, captureEnd;
  ch = state.input.charCodeAt(state.position);
  if (ch !== 39) {
    return false;
  }
  state.kind = "scalar";
  state.result = "";
  state.position++;
  captureStart = captureEnd = state.position;
  while ((ch = state.input.charCodeAt(state.position)) !== 0) {
    if (ch === 39) {
      captureSegment(state, captureStart, state.position, true);
      ch = state.input.charCodeAt(++state.position);
      if (ch === 39) {
        captureStart = state.position;
        state.position++;
        captureEnd = state.position;
      } else {
        return true;
      }
    } else if (is_EOL(ch)) {
      captureSegment(state, captureStart, captureEnd, true);
      writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
      captureStart = captureEnd = state.position;
    } else if (state.position === state.lineStart && testDocumentSeparator(state)) {
      throwError(state, "unexpected end of the document within a single quoted scalar");
    } else {
      state.position++;
      captureEnd = state.position;
    }
  }
  throwError(state, "unexpected end of the stream within a single quoted scalar");
}
function readDoubleQuotedScalar(state, nodeIndent) {
  var captureStart, captureEnd, hexLength, hexResult, tmp, ch;
  ch = state.input.charCodeAt(state.position);
  if (ch !== 34) {
    return false;
  }
  state.kind = "scalar";
  state.result = "";
  state.position++;
  captureStart = captureEnd = state.position;
  while ((ch = state.input.charCodeAt(state.position)) !== 0) {
    if (ch === 34) {
      captureSegment(state, captureStart, state.position, true);
      state.position++;
      return true;
    } else if (ch === 92) {
      captureSegment(state, captureStart, state.position, true);
      ch = state.input.charCodeAt(++state.position);
      if (is_EOL(ch)) {
        skipSeparationSpace(state, false, nodeIndent);
      } else if (ch < 256 && simpleEscapeCheck[ch]) {
        state.result += simpleEscapeMap[ch];
        state.position++;
      } else if ((tmp = escapedHexLen(ch)) > 0) {
        hexLength = tmp;
        hexResult = 0;
        for (; hexLength > 0; hexLength--) {
          ch = state.input.charCodeAt(++state.position);
          if ((tmp = fromHexCode(ch)) >= 0) {
            hexResult = (hexResult << 4) + tmp;
          } else {
            throwError(state, "expected hexadecimal character");
          }
        }
        state.result += charFromCodepoint(hexResult);
        state.position++;
      } else {
        throwError(state, "unknown escape sequence");
      }
      captureStart = captureEnd = state.position;
    } else if (is_EOL(ch)) {
      captureSegment(state, captureStart, captureEnd, true);
      writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
      captureStart = captureEnd = state.position;
    } else if (state.position === state.lineStart && testDocumentSeparator(state)) {
      throwError(state, "unexpected end of the document within a double quoted scalar");
    } else {
      state.position++;
      captureEnd = state.position;
    }
  }
  throwError(state, "unexpected end of the stream within a double quoted scalar");
}
function readFlowCollection(state, nodeIndent) {
  var readNext = true, _line, _lineStart, _pos, _tag = state.tag, _result, _anchor = state.anchor, following, terminator, isPair, isExplicitPair, isMapping, overridableKeys = /* @__PURE__ */ Object.create(null), keyNode, keyTag, valueNode, ch;
  ch = state.input.charCodeAt(state.position);
  if (ch === 91) {
    terminator = 93;
    isMapping = false;
    _result = [];
  } else if (ch === 123) {
    terminator = 125;
    isMapping = true;
    _result = {};
  } else {
    return false;
  }
  if (state.anchor !== null) {
    state.anchorMap[state.anchor] = _result;
  }
  ch = state.input.charCodeAt(++state.position);
  while (ch !== 0) {
    skipSeparationSpace(state, true, nodeIndent);
    ch = state.input.charCodeAt(state.position);
    if (ch === terminator) {
      state.position++;
      state.tag = _tag;
      state.anchor = _anchor;
      state.kind = isMapping ? "mapping" : "sequence";
      state.result = _result;
      return true;
    } else if (!readNext) {
      throwError(state, "missed comma between flow collection entries");
    } else if (ch === 44) {
      throwError(state, "expected the node content, but found ','");
    }
    keyTag = keyNode = valueNode = null;
    isPair = isExplicitPair = false;
    if (ch === 63) {
      following = state.input.charCodeAt(state.position + 1);
      if (is_WS_OR_EOL(following)) {
        isPair = isExplicitPair = true;
        state.position++;
        skipSeparationSpace(state, true, nodeIndent);
      }
    }
    _line = state.line;
    _lineStart = state.lineStart;
    _pos = state.position;
    composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
    keyTag = state.tag;
    keyNode = state.result;
    skipSeparationSpace(state, true, nodeIndent);
    ch = state.input.charCodeAt(state.position);
    if ((isExplicitPair || state.line === _line) && ch === 58) {
      isPair = true;
      ch = state.input.charCodeAt(++state.position);
      skipSeparationSpace(state, true, nodeIndent);
      composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
      valueNode = state.result;
    }
    if (isMapping) {
      storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos);
    } else if (isPair) {
      _result.push(storeMappingPair(state, null, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos));
    } else {
      _result.push(keyNode);
    }
    skipSeparationSpace(state, true, nodeIndent);
    ch = state.input.charCodeAt(state.position);
    if (ch === 44) {
      readNext = true;
      ch = state.input.charCodeAt(++state.position);
    } else {
      readNext = false;
    }
  }
  throwError(state, "unexpected end of the stream within a flow collection");
}
function readBlockScalar(state, nodeIndent) {
  var captureStart, folding, chomping = CHOMPING_CLIP, didReadContent = false, detectedIndent = false, textIndent = nodeIndent, emptyLines = 0, atMoreIndented = false, tmp, ch;
  ch = state.input.charCodeAt(state.position);
  if (ch === 124) {
    folding = false;
  } else if (ch === 62) {
    folding = true;
  } else {
    return false;
  }
  state.kind = "scalar";
  state.result = "";
  while (ch !== 0) {
    ch = state.input.charCodeAt(++state.position);
    if (ch === 43 || ch === 45) {
      if (CHOMPING_CLIP === chomping) {
        chomping = ch === 43 ? CHOMPING_KEEP : CHOMPING_STRIP;
      } else {
        throwError(state, "repeat of a chomping mode identifier");
      }
    } else if ((tmp = fromDecimalCode(ch)) >= 0) {
      if (tmp === 0) {
        throwError(state, "bad explicit indentation width of a block scalar; it cannot be less than one");
      } else if (!detectedIndent) {
        textIndent = nodeIndent + tmp - 1;
        detectedIndent = true;
      } else {
        throwError(state, "repeat of an indentation width identifier");
      }
    } else {
      break;
    }
  }
  if (is_WHITE_SPACE(ch)) {
    do {
      ch = state.input.charCodeAt(++state.position);
    } while (is_WHITE_SPACE(ch));
    if (ch === 35) {
      do {
        ch = state.input.charCodeAt(++state.position);
      } while (!is_EOL(ch) && ch !== 0);
    }
  }
  while (ch !== 0) {
    readLineBreak(state);
    state.lineIndent = 0;
    ch = state.input.charCodeAt(state.position);
    while ((!detectedIndent || state.lineIndent < textIndent) && ch === 32) {
      state.lineIndent++;
      ch = state.input.charCodeAt(++state.position);
    }
    if (!detectedIndent && state.lineIndent > textIndent) {
      textIndent = state.lineIndent;
    }
    if (is_EOL(ch)) {
      emptyLines++;
      continue;
    }
    if (state.lineIndent < textIndent) {
      if (chomping === CHOMPING_KEEP) {
        state.result += common.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
      } else if (chomping === CHOMPING_CLIP) {
        if (didReadContent) {
          state.result += "\n";
        }
      }
      break;
    }
    if (folding) {
      if (is_WHITE_SPACE(ch)) {
        atMoreIndented = true;
        state.result += common.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
      } else if (atMoreIndented) {
        atMoreIndented = false;
        state.result += common.repeat("\n", emptyLines + 1);
      } else if (emptyLines === 0) {
        if (didReadContent) {
          state.result += " ";
        }
      } else {
        state.result += common.repeat("\n", emptyLines);
      }
    } else {
      state.result += common.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
    }
    didReadContent = true;
    detectedIndent = true;
    emptyLines = 0;
    captureStart = state.position;
    while (!is_EOL(ch) && ch !== 0) {
      ch = state.input.charCodeAt(++state.position);
    }
    captureSegment(state, captureStart, state.position, false);
  }
  return true;
}
function readBlockSequence(state, nodeIndent) {
  var _line, _tag = state.tag, _anchor = state.anchor, _result = [], following, detected = false, ch;
  if (state.firstTabInLine !== -1) return false;
  if (state.anchor !== null) {
    state.anchorMap[state.anchor] = _result;
  }
  ch = state.input.charCodeAt(state.position);
  while (ch !== 0) {
    if (state.firstTabInLine !== -1) {
      state.position = state.firstTabInLine;
      throwError(state, "tab characters must not be used in indentation");
    }
    if (ch !== 45) {
      break;
    }
    following = state.input.charCodeAt(state.position + 1);
    if (!is_WS_OR_EOL(following)) {
      break;
    }
    detected = true;
    state.position++;
    if (skipSeparationSpace(state, true, -1)) {
      if (state.lineIndent <= nodeIndent) {
        _result.push(null);
        ch = state.input.charCodeAt(state.position);
        continue;
      }
    }
    _line = state.line;
    composeNode(state, nodeIndent, CONTEXT_BLOCK_IN, false, true);
    _result.push(state.result);
    skipSeparationSpace(state, true, -1);
    ch = state.input.charCodeAt(state.position);
    if ((state.line === _line || state.lineIndent > nodeIndent) && ch !== 0) {
      throwError(state, "bad indentation of a sequence entry");
    } else if (state.lineIndent < nodeIndent) {
      break;
    }
  }
  if (detected) {
    state.tag = _tag;
    state.anchor = _anchor;
    state.kind = "sequence";
    state.result = _result;
    return true;
  }
  return false;
}
function readBlockMapping(state, nodeIndent, flowIndent) {
  var following, allowCompact, _line, _keyLine, _keyLineStart, _keyPos, _tag = state.tag, _anchor = state.anchor, _result = {}, overridableKeys = /* @__PURE__ */ Object.create(null), keyTag = null, keyNode = null, valueNode = null, atExplicitKey = false, detected = false, ch;
  if (state.firstTabInLine !== -1) return false;
  if (state.anchor !== null) {
    state.anchorMap[state.anchor] = _result;
  }
  ch = state.input.charCodeAt(state.position);
  while (ch !== 0) {
    if (!atExplicitKey && state.firstTabInLine !== -1) {
      state.position = state.firstTabInLine;
      throwError(state, "tab characters must not be used in indentation");
    }
    following = state.input.charCodeAt(state.position + 1);
    _line = state.line;
    if ((ch === 63 || ch === 58) && is_WS_OR_EOL(following)) {
      if (ch === 63) {
        if (atExplicitKey) {
          storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
          keyTag = keyNode = valueNode = null;
        }
        detected = true;
        atExplicitKey = true;
        allowCompact = true;
      } else if (atExplicitKey) {
        atExplicitKey = false;
        allowCompact = true;
      } else {
        throwError(state, "incomplete explicit mapping pair; a key node is missed; or followed by a non-tabulated empty line");
      }
      state.position += 1;
      ch = following;
    } else {
      _keyLine = state.line;
      _keyLineStart = state.lineStart;
      _keyPos = state.position;
      if (!composeNode(state, flowIndent, CONTEXT_FLOW_OUT, false, true)) {
        break;
      }
      if (state.line === _line) {
        ch = state.input.charCodeAt(state.position);
        while (is_WHITE_SPACE(ch)) {
          ch = state.input.charCodeAt(++state.position);
        }
        if (ch === 58) {
          ch = state.input.charCodeAt(++state.position);
          if (!is_WS_OR_EOL(ch)) {
            throwError(state, "a whitespace character is expected after the key-value separator within a block mapping");
          }
          if (atExplicitKey) {
            storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
            keyTag = keyNode = valueNode = null;
          }
          detected = true;
          atExplicitKey = false;
          allowCompact = false;
          keyTag = state.tag;
          keyNode = state.result;
        } else if (detected) {
          throwError(state, "can not read an implicit mapping pair; a colon is missed");
        } else {
          state.tag = _tag;
          state.anchor = _anchor;
          return true;
        }
      } else if (detected) {
        throwError(state, "can not read a block mapping entry; a multiline key may not be an implicit key");
      } else {
        state.tag = _tag;
        state.anchor = _anchor;
        return true;
      }
    }
    if (state.line === _line || state.lineIndent > nodeIndent) {
      if (atExplicitKey) {
        _keyLine = state.line;
        _keyLineStart = state.lineStart;
        _keyPos = state.position;
      }
      if (composeNode(state, nodeIndent, CONTEXT_BLOCK_OUT, true, allowCompact)) {
        if (atExplicitKey) {
          keyNode = state.result;
        } else {
          valueNode = state.result;
        }
      }
      if (!atExplicitKey) {
        storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _keyLine, _keyLineStart, _keyPos);
        keyTag = keyNode = valueNode = null;
      }
      skipSeparationSpace(state, true, -1);
      ch = state.input.charCodeAt(state.position);
    }
    if ((state.line === _line || state.lineIndent > nodeIndent) && ch !== 0) {
      throwError(state, "bad indentation of a mapping entry");
    } else if (state.lineIndent < nodeIndent) {
      break;
    }
  }
  if (atExplicitKey) {
    storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
  }
  if (detected) {
    state.tag = _tag;
    state.anchor = _anchor;
    state.kind = "mapping";
    state.result = _result;
  }
  return detected;
}
function readTagProperty(state) {
  var _position, isVerbatim = false, isNamed = false, tagHandle, tagName, ch;
  ch = state.input.charCodeAt(state.position);
  if (ch !== 33) return false;
  if (state.tag !== null) {
    throwError(state, "duplication of a tag property");
  }
  ch = state.input.charCodeAt(++state.position);
  if (ch === 60) {
    isVerbatim = true;
    ch = state.input.charCodeAt(++state.position);
  } else if (ch === 33) {
    isNamed = true;
    tagHandle = "!!";
    ch = state.input.charCodeAt(++state.position);
  } else {
    tagHandle = "!";
  }
  _position = state.position;
  if (isVerbatim) {
    do {
      ch = state.input.charCodeAt(++state.position);
    } while (ch !== 0 && ch !== 62);
    if (state.position < state.length) {
      tagName = state.input.slice(_position, state.position);
      ch = state.input.charCodeAt(++state.position);
    } else {
      throwError(state, "unexpected end of the stream within a verbatim tag");
    }
  } else {
    while (ch !== 0 && !is_WS_OR_EOL(ch)) {
      if (ch === 33) {
        if (!isNamed) {
          tagHandle = state.input.slice(_position - 1, state.position + 1);
          if (!PATTERN_TAG_HANDLE.test(tagHandle)) {
            throwError(state, "named tag handle cannot contain such characters");
          }
          isNamed = true;
          _position = state.position + 1;
        } else {
          throwError(state, "tag suffix cannot contain exclamation marks");
        }
      }
      ch = state.input.charCodeAt(++state.position);
    }
    tagName = state.input.slice(_position, state.position);
    if (PATTERN_FLOW_INDICATORS.test(tagName)) {
      throwError(state, "tag suffix cannot contain flow indicator characters");
    }
  }
  if (tagName && !PATTERN_TAG_URI.test(tagName)) {
    throwError(state, "tag name cannot contain such characters: " + tagName);
  }
  try {
    tagName = decodeURIComponent(tagName);
  } catch (err) {
    throwError(state, "tag name is malformed: " + tagName);
  }
  if (isVerbatim) {
    state.tag = tagName;
  } else if (_hasOwnProperty$1.call(state.tagMap, tagHandle)) {
    state.tag = state.tagMap[tagHandle] + tagName;
  } else if (tagHandle === "!") {
    state.tag = "!" + tagName;
  } else if (tagHandle === "!!") {
    state.tag = "tag:yaml.org,2002:" + tagName;
  } else {
    throwError(state, 'undeclared tag handle "' + tagHandle + '"');
  }
  return true;
}
function readAnchorProperty(state) {
  var _position, ch;
  ch = state.input.charCodeAt(state.position);
  if (ch !== 38) return false;
  if (state.anchor !== null) {
    throwError(state, "duplication of an anchor property");
  }
  ch = state.input.charCodeAt(++state.position);
  _position = state.position;
  while (ch !== 0 && !is_WS_OR_EOL(ch) && !is_FLOW_INDICATOR(ch)) {
    ch = state.input.charCodeAt(++state.position);
  }
  if (state.position === _position) {
    throwError(state, "name of an anchor node must contain at least one character");
  }
  state.anchor = state.input.slice(_position, state.position);
  return true;
}
function readAlias(state) {
  var _position, alias, ch;
  ch = state.input.charCodeAt(state.position);
  if (ch !== 42) return false;
  ch = state.input.charCodeAt(++state.position);
  _position = state.position;
  while (ch !== 0 && !is_WS_OR_EOL(ch) && !is_FLOW_INDICATOR(ch)) {
    ch = state.input.charCodeAt(++state.position);
  }
  if (state.position === _position) {
    throwError(state, "name of an alias node must contain at least one character");
  }
  alias = state.input.slice(_position, state.position);
  if (!_hasOwnProperty$1.call(state.anchorMap, alias)) {
    throwError(state, 'unidentified alias "' + alias + '"');
  }
  state.result = state.anchorMap[alias];
  skipSeparationSpace(state, true, -1);
  return true;
}
function composeNode(state, parentIndent, nodeContext, allowToSeek, allowCompact) {
  var allowBlockStyles, allowBlockScalars, allowBlockCollections, indentStatus = 1, atNewLine = false, hasContent = false, typeIndex, typeQuantity, typeList, type2, flowIndent, blockIndent;
  if (state.listener !== null) {
    state.listener("open", state);
  }
  state.tag = null;
  state.anchor = null;
  state.kind = null;
  state.result = null;
  allowBlockStyles = allowBlockScalars = allowBlockCollections = CONTEXT_BLOCK_OUT === nodeContext || CONTEXT_BLOCK_IN === nodeContext;
  if (allowToSeek) {
    if (skipSeparationSpace(state, true, -1)) {
      atNewLine = true;
      if (state.lineIndent > parentIndent) {
        indentStatus = 1;
      } else if (state.lineIndent === parentIndent) {
        indentStatus = 0;
      } else if (state.lineIndent < parentIndent) {
        indentStatus = -1;
      }
    }
  }
  if (indentStatus === 1) {
    while (readTagProperty(state) || readAnchorProperty(state)) {
      if (skipSeparationSpace(state, true, -1)) {
        atNewLine = true;
        allowBlockCollections = allowBlockStyles;
        if (state.lineIndent > parentIndent) {
          indentStatus = 1;
        } else if (state.lineIndent === parentIndent) {
          indentStatus = 0;
        } else if (state.lineIndent < parentIndent) {
          indentStatus = -1;
        }
      } else {
        allowBlockCollections = false;
      }
    }
  }
  if (allowBlockCollections) {
    allowBlockCollections = atNewLine || allowCompact;
  }
  if (indentStatus === 1 || CONTEXT_BLOCK_OUT === nodeContext) {
    if (CONTEXT_FLOW_IN === nodeContext || CONTEXT_FLOW_OUT === nodeContext) {
      flowIndent = parentIndent;
    } else {
      flowIndent = parentIndent + 1;
    }
    blockIndent = state.position - state.lineStart;
    if (indentStatus === 1) {
      if (allowBlockCollections && (readBlockSequence(state, blockIndent) || readBlockMapping(state, blockIndent, flowIndent)) || readFlowCollection(state, flowIndent)) {
        hasContent = true;
      } else {
        if (allowBlockScalars && readBlockScalar(state, flowIndent) || readSingleQuotedScalar(state, flowIndent) || readDoubleQuotedScalar(state, flowIndent)) {
          hasContent = true;
        } else if (readAlias(state)) {
          hasContent = true;
          if (state.tag !== null || state.anchor !== null) {
            throwError(state, "alias node should not have any properties");
          }
        } else if (readPlainScalar(state, flowIndent, CONTEXT_FLOW_IN === nodeContext)) {
          hasContent = true;
          if (state.tag === null) {
            state.tag = "?";
          }
        }
        if (state.anchor !== null) {
          state.anchorMap[state.anchor] = state.result;
        }
      }
    } else if (indentStatus === 0) {
      hasContent = allowBlockCollections && readBlockSequence(state, blockIndent);
    }
  }
  if (state.tag === null) {
    if (state.anchor !== null) {
      state.anchorMap[state.anchor] = state.result;
    }
  } else if (state.tag === "?") {
    if (state.result !== null && state.kind !== "scalar") {
      throwError(state, 'unacceptable node kind for !<?> tag; it should be "scalar", not "' + state.kind + '"');
    }
    for (typeIndex = 0, typeQuantity = state.implicitTypes.length; typeIndex < typeQuantity; typeIndex += 1) {
      type2 = state.implicitTypes[typeIndex];
      if (type2.resolve(state.result)) {
        state.result = type2.construct(state.result);
        state.tag = type2.tag;
        if (state.anchor !== null) {
          state.anchorMap[state.anchor] = state.result;
        }
        break;
      }
    }
  } else if (state.tag !== "!") {
    if (_hasOwnProperty$1.call(state.typeMap[state.kind || "fallback"], state.tag)) {
      type2 = state.typeMap[state.kind || "fallback"][state.tag];
    } else {
      type2 = null;
      typeList = state.typeMap.multi[state.kind || "fallback"];
      for (typeIndex = 0, typeQuantity = typeList.length; typeIndex < typeQuantity; typeIndex += 1) {
        if (state.tag.slice(0, typeList[typeIndex].tag.length) === typeList[typeIndex].tag) {
          type2 = typeList[typeIndex];
          break;
        }
      }
    }
    if (!type2) {
      throwError(state, "unknown tag !<" + state.tag + ">");
    }
    if (state.result !== null && type2.kind !== state.kind) {
      throwError(state, "unacceptable node kind for !<" + state.tag + '> tag; it should be "' + type2.kind + '", not "' + state.kind + '"');
    }
    if (!type2.resolve(state.result, state.tag)) {
      throwError(state, "cannot resolve a node with !<" + state.tag + "> explicit tag");
    } else {
      state.result = type2.construct(state.result, state.tag);
      if (state.anchor !== null) {
        state.anchorMap[state.anchor] = state.result;
      }
    }
  }
  if (state.listener !== null) {
    state.listener("close", state);
  }
  return state.tag !== null || state.anchor !== null || hasContent;
}
function readDocument(state) {
  var documentStart = state.position, _position, directiveName, directiveArgs, hasDirectives = false, ch;
  state.version = null;
  state.checkLineBreaks = state.legacy;
  state.tagMap = /* @__PURE__ */ Object.create(null);
  state.anchorMap = /* @__PURE__ */ Object.create(null);
  while ((ch = state.input.charCodeAt(state.position)) !== 0) {
    skipSeparationSpace(state, true, -1);
    ch = state.input.charCodeAt(state.position);
    if (state.lineIndent > 0 || ch !== 37) {
      break;
    }
    hasDirectives = true;
    ch = state.input.charCodeAt(++state.position);
    _position = state.position;
    while (ch !== 0 && !is_WS_OR_EOL(ch)) {
      ch = state.input.charCodeAt(++state.position);
    }
    directiveName = state.input.slice(_position, state.position);
    directiveArgs = [];
    if (directiveName.length < 1) {
      throwError(state, "directive name must not be less than one character in length");
    }
    while (ch !== 0) {
      while (is_WHITE_SPACE(ch)) {
        ch = state.input.charCodeAt(++state.position);
      }
      if (ch === 35) {
        do {
          ch = state.input.charCodeAt(++state.position);
        } while (ch !== 0 && !is_EOL(ch));
        break;
      }
      if (is_EOL(ch)) break;
      _position = state.position;
      while (ch !== 0 && !is_WS_OR_EOL(ch)) {
        ch = state.input.charCodeAt(++state.position);
      }
      directiveArgs.push(state.input.slice(_position, state.position));
    }
    if (ch !== 0) readLineBreak(state);
    if (_hasOwnProperty$1.call(directiveHandlers, directiveName)) {
      directiveHandlers[directiveName](state, directiveName, directiveArgs);
    } else {
      throwWarning(state, 'unknown document directive "' + directiveName + '"');
    }
  }
  skipSeparationSpace(state, true, -1);
  if (state.lineIndent === 0 && state.input.charCodeAt(state.position) === 45 && state.input.charCodeAt(state.position + 1) === 45 && state.input.charCodeAt(state.position + 2) === 45) {
    state.position += 3;
    skipSeparationSpace(state, true, -1);
  } else if (hasDirectives) {
    throwError(state, "directives end mark is expected");
  }
  composeNode(state, state.lineIndent - 1, CONTEXT_BLOCK_OUT, false, true);
  skipSeparationSpace(state, true, -1);
  if (state.checkLineBreaks && PATTERN_NON_ASCII_LINE_BREAKS.test(state.input.slice(documentStart, state.position))) {
    throwWarning(state, "non-ASCII line breaks are interpreted as content");
  }
  state.documents.push(state.result);
  if (state.position === state.lineStart && testDocumentSeparator(state)) {
    if (state.input.charCodeAt(state.position) === 46) {
      state.position += 3;
      skipSeparationSpace(state, true, -1);
    }
    return;
  }
  if (state.position < state.length - 1) {
    throwError(state, "end of the stream or a document separator is expected");
  } else {
    return;
  }
}
function loadDocuments(input, options) {
  input = String(input);
  options = options || {};
  if (input.length !== 0) {
    if (input.charCodeAt(input.length - 1) !== 10 && input.charCodeAt(input.length - 1) !== 13) {
      input += "\n";
    }
    if (input.charCodeAt(0) === 65279) {
      input = input.slice(1);
    }
  }
  var state = new State$1(input, options);
  var nullpos = input.indexOf("\0");
  if (nullpos !== -1) {
    state.position = nullpos;
    throwError(state, "null byte is not allowed in input");
  }
  state.input += "\0";
  while (state.input.charCodeAt(state.position) === 32) {
    state.lineIndent += 1;
    state.position += 1;
  }
  while (state.position < state.length - 1) {
    readDocument(state);
  }
  return state.documents;
}
function loadAll$1(input, iterator, options) {
  if (iterator !== null && typeof iterator === "object" && typeof options === "undefined") {
    options = iterator;
    iterator = null;
  }
  var documents = loadDocuments(input, options);
  if (typeof iterator !== "function") {
    return documents;
  }
  for (var index = 0, length = documents.length; index < length; index += 1) {
    iterator(documents[index]);
  }
}
function load$1(input, options) {
  var documents = loadDocuments(input, options);
  if (documents.length === 0) {
    return void 0;
  } else if (documents.length === 1) {
    return documents[0];
  }
  throw new exception("expected a single document in the stream, but found more");
}
var loadAll_1 = loadAll$1;
var load_1 = load$1;
var loader = {
  loadAll: loadAll_1,
  load: load_1
};
var _toString = Object.prototype.toString;
var _hasOwnProperty = Object.prototype.hasOwnProperty;
var CHAR_BOM = 65279;
var CHAR_TAB = 9;
var CHAR_LINE_FEED = 10;
var CHAR_CARRIAGE_RETURN = 13;
var CHAR_SPACE = 32;
var CHAR_EXCLAMATION = 33;
var CHAR_DOUBLE_QUOTE = 34;
var CHAR_SHARP = 35;
var CHAR_PERCENT = 37;
var CHAR_AMPERSAND = 38;
var CHAR_SINGLE_QUOTE = 39;
var CHAR_ASTERISK = 42;
var CHAR_COMMA = 44;
var CHAR_MINUS = 45;
var CHAR_COLON = 58;
var CHAR_EQUALS = 61;
var CHAR_GREATER_THAN = 62;
var CHAR_QUESTION = 63;
var CHAR_COMMERCIAL_AT = 64;
var CHAR_LEFT_SQUARE_BRACKET = 91;
var CHAR_RIGHT_SQUARE_BRACKET = 93;
var CHAR_GRAVE_ACCENT = 96;
var CHAR_LEFT_CURLY_BRACKET = 123;
var CHAR_VERTICAL_LINE = 124;
var CHAR_RIGHT_CURLY_BRACKET = 125;
var ESCAPE_SEQUENCES = {};
ESCAPE_SEQUENCES[0] = "\\0";
ESCAPE_SEQUENCES[7] = "\\a";
ESCAPE_SEQUENCES[8] = "\\b";
ESCAPE_SEQUENCES[9] = "\\t";
ESCAPE_SEQUENCES[10] = "\\n";
ESCAPE_SEQUENCES[11] = "\\v";
ESCAPE_SEQUENCES[12] = "\\f";
ESCAPE_SEQUENCES[13] = "\\r";
ESCAPE_SEQUENCES[27] = "\\e";
ESCAPE_SEQUENCES[34] = '\\"';
ESCAPE_SEQUENCES[92] = "\\\\";
ESCAPE_SEQUENCES[133] = "\\N";
ESCAPE_SEQUENCES[160] = "\\_";
ESCAPE_SEQUENCES[8232] = "\\L";
ESCAPE_SEQUENCES[8233] = "\\P";
var DEPRECATED_BOOLEANS_SYNTAX = [
  "y",
  "Y",
  "yes",
  "Yes",
  "YES",
  "on",
  "On",
  "ON",
  "n",
  "N",
  "no",
  "No",
  "NO",
  "off",
  "Off",
  "OFF"
];
var DEPRECATED_BASE60_SYNTAX = /^[-+]?[0-9_]+(?::[0-9_]+)+(?:\.[0-9_]*)?$/;
function compileStyleMap(schema2, map2) {
  var result, keys, index, length, tag, style, type2;
  if (map2 === null) return {};
  result = {};
  keys = Object.keys(map2);
  for (index = 0, length = keys.length; index < length; index += 1) {
    tag = keys[index];
    style = String(map2[tag]);
    if (tag.slice(0, 2) === "!!") {
      tag = "tag:yaml.org,2002:" + tag.slice(2);
    }
    type2 = schema2.compiledTypeMap["fallback"][tag];
    if (type2 && _hasOwnProperty.call(type2.styleAliases, style)) {
      style = type2.styleAliases[style];
    }
    result[tag] = style;
  }
  return result;
}
function encodeHex(character) {
  var string, handle, length;
  string = character.toString(16).toUpperCase();
  if (character <= 255) {
    handle = "x";
    length = 2;
  } else if (character <= 65535) {
    handle = "u";
    length = 4;
  } else if (character <= 4294967295) {
    handle = "U";
    length = 8;
  } else {
    throw new exception("code point within a string may not be greater than 0xFFFFFFFF");
  }
  return "\\" + handle + common.repeat("0", length - string.length) + string;
}
var QUOTING_TYPE_SINGLE = 1;
var QUOTING_TYPE_DOUBLE = 2;
function State(options) {
  this.schema = options["schema"] || _default;
  this.indent = Math.max(1, options["indent"] || 2);
  this.noArrayIndent = options["noArrayIndent"] || false;
  this.skipInvalid = options["skipInvalid"] || false;
  this.flowLevel = common.isNothing(options["flowLevel"]) ? -1 : options["flowLevel"];
  this.styleMap = compileStyleMap(this.schema, options["styles"] || null);
  this.sortKeys = options["sortKeys"] || false;
  this.lineWidth = options["lineWidth"] || 80;
  this.noRefs = options["noRefs"] || false;
  this.noCompatMode = options["noCompatMode"] || false;
  this.condenseFlow = options["condenseFlow"] || false;
  this.quotingType = options["quotingType"] === '"' ? QUOTING_TYPE_DOUBLE : QUOTING_TYPE_SINGLE;
  this.forceQuotes = options["forceQuotes"] || false;
  this.replacer = typeof options["replacer"] === "function" ? options["replacer"] : null;
  this.implicitTypes = this.schema.compiledImplicit;
  this.explicitTypes = this.schema.compiledExplicit;
  this.tag = null;
  this.result = "";
  this.duplicates = [];
  this.usedDuplicates = null;
}
function indentString(string, spaces) {
  var ind = common.repeat(" ", spaces), position = 0, next = -1, result = "", line, length = string.length;
  while (position < length) {
    next = string.indexOf("\n", position);
    if (next === -1) {
      line = string.slice(position);
      position = length;
    } else {
      line = string.slice(position, next + 1);
      position = next + 1;
    }
    if (line.length && line !== "\n") result += ind;
    result += line;
  }
  return result;
}
function generateNextLine(state, level) {
  return "\n" + common.repeat(" ", state.indent * level);
}
function testImplicitResolving(state, str2) {
  var index, length, type2;
  for (index = 0, length = state.implicitTypes.length; index < length; index += 1) {
    type2 = state.implicitTypes[index];
    if (type2.resolve(str2)) {
      return true;
    }
  }
  return false;
}
function isWhitespace(c) {
  return c === CHAR_SPACE || c === CHAR_TAB;
}
function isPrintable(c) {
  return 32 <= c && c <= 126 || 161 <= c && c <= 55295 && c !== 8232 && c !== 8233 || 57344 <= c && c <= 65533 && c !== CHAR_BOM || 65536 <= c && c <= 1114111;
}
function isNsCharOrWhitespace(c) {
  return isPrintable(c) && c !== CHAR_BOM && c !== CHAR_CARRIAGE_RETURN && c !== CHAR_LINE_FEED;
}
function isPlainSafe(c, prev, inblock) {
  var cIsNsCharOrWhitespace = isNsCharOrWhitespace(c);
  var cIsNsChar = cIsNsCharOrWhitespace && !isWhitespace(c);
  return (
    // ns-plain-safe
    (inblock ? (
      // c = flow-in
      cIsNsCharOrWhitespace
    ) : cIsNsCharOrWhitespace && c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET) && c !== CHAR_SHARP && !(prev === CHAR_COLON && !cIsNsChar) || isNsCharOrWhitespace(prev) && !isWhitespace(prev) && c === CHAR_SHARP || prev === CHAR_COLON && cIsNsChar
  );
}
function isPlainSafeFirst(c) {
  return isPrintable(c) && c !== CHAR_BOM && !isWhitespace(c) && c !== CHAR_MINUS && c !== CHAR_QUESTION && c !== CHAR_COLON && c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET && c !== CHAR_SHARP && c !== CHAR_AMPERSAND && c !== CHAR_ASTERISK && c !== CHAR_EXCLAMATION && c !== CHAR_VERTICAL_LINE && c !== CHAR_EQUALS && c !== CHAR_GREATER_THAN && c !== CHAR_SINGLE_QUOTE && c !== CHAR_DOUBLE_QUOTE && c !== CHAR_PERCENT && c !== CHAR_COMMERCIAL_AT && c !== CHAR_GRAVE_ACCENT;
}
function isPlainSafeLast(c) {
  return !isWhitespace(c) && c !== CHAR_COLON;
}
function codePointAt(string, pos) {
  var first = string.charCodeAt(pos), second;
  if (first >= 55296 && first <= 56319 && pos + 1 < string.length) {
    second = string.charCodeAt(pos + 1);
    if (second >= 56320 && second <= 57343) {
      return (first - 55296) * 1024 + second - 56320 + 65536;
    }
  }
  return first;
}
function needIndentIndicator(string) {
  var leadingSpaceRe = /^\n* /;
  return leadingSpaceRe.test(string);
}
var STYLE_PLAIN = 1;
var STYLE_SINGLE = 2;
var STYLE_LITERAL = 3;
var STYLE_FOLDED = 4;
var STYLE_DOUBLE = 5;
function chooseScalarStyle(string, singleLineOnly, indentPerLevel, lineWidth, testAmbiguousType, quotingType, forceQuotes, inblock) {
  var i;
  var char = 0;
  var prevChar = null;
  var hasLineBreak = false;
  var hasFoldableLine = false;
  var shouldTrackWidth = lineWidth !== -1;
  var previousLineBreak = -1;
  var plain = isPlainSafeFirst(codePointAt(string, 0)) && isPlainSafeLast(codePointAt(string, string.length - 1));
  if (singleLineOnly || forceQuotes) {
    for (i = 0; i < string.length; char >= 65536 ? i += 2 : i++) {
      char = codePointAt(string, i);
      if (!isPrintable(char)) {
        return STYLE_DOUBLE;
      }
      plain = plain && isPlainSafe(char, prevChar, inblock);
      prevChar = char;
    }
  } else {
    for (i = 0; i < string.length; char >= 65536 ? i += 2 : i++) {
      char = codePointAt(string, i);
      if (char === CHAR_LINE_FEED) {
        hasLineBreak = true;
        if (shouldTrackWidth) {
          hasFoldableLine = hasFoldableLine || // Foldable line = too long, and not more-indented.
            i - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ";
          previousLineBreak = i;
        }
      } else if (!isPrintable(char)) {
        return STYLE_DOUBLE;
      }
      plain = plain && isPlainSafe(char, prevChar, inblock);
      prevChar = char;
    }
    hasFoldableLine = hasFoldableLine || shouldTrackWidth && (i - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ");
  }
  if (!hasLineBreak && !hasFoldableLine) {
    if (plain && !forceQuotes && !testAmbiguousType(string)) {
      return STYLE_PLAIN;
    }
    return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE;
  }
  if (indentPerLevel > 9 && needIndentIndicator(string)) {
    return STYLE_DOUBLE;
  }
  if (!forceQuotes) {
    return hasFoldableLine ? STYLE_FOLDED : STYLE_LITERAL;
  }
  return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE;
}
function writeScalar(state, string, level, iskey, inblock) {
  state.dump = (function () {
    if (string.length === 0) {
      return state.quotingType === QUOTING_TYPE_DOUBLE ? '""' : "''";
    }
    if (!state.noCompatMode) {
      if (DEPRECATED_BOOLEANS_SYNTAX.indexOf(string) !== -1 || DEPRECATED_BASE60_SYNTAX.test(string)) {
        return state.quotingType === QUOTING_TYPE_DOUBLE ? '"' + string + '"' : "'" + string + "'";
      }
    }
    var indent = state.indent * Math.max(1, level);
    var lineWidth = state.lineWidth === -1 ? -1 : Math.max(Math.min(state.lineWidth, 40), state.lineWidth - indent);
    var singleLineOnly = iskey || state.flowLevel > -1 && level >= state.flowLevel;
    function testAmbiguity(string2) {
      return testImplicitResolving(state, string2);
    }
    switch (chooseScalarStyle(
      string,
      singleLineOnly,
      state.indent,
      lineWidth,
      testAmbiguity,
      state.quotingType,
      state.forceQuotes && !iskey,
      inblock
    )) {
      case STYLE_PLAIN:
        return string;
      case STYLE_SINGLE:
        return "'" + string.replace(/'/g, "''") + "'";
      case STYLE_LITERAL:
        return "|" + blockHeader(string, state.indent) + dropEndingNewline(indentString(string, indent));
      case STYLE_FOLDED:
        return ">" + blockHeader(string, state.indent) + dropEndingNewline(indentString(foldString(string, lineWidth), indent));
      case STYLE_DOUBLE:
        return '"' + escapeString(string) + '"';
      default:
        throw new exception("impossible error: invalid scalar style");
    }
  })();
}
function blockHeader(string, indentPerLevel) {
  var indentIndicator = needIndentIndicator(string) ? String(indentPerLevel) : "";
  var clip = string[string.length - 1] === "\n";
  var keep = clip && (string[string.length - 2] === "\n" || string === "\n");
  var chomp = keep ? "+" : clip ? "" : "-";
  return indentIndicator + chomp + "\n";
}
function dropEndingNewline(string) {
  return string[string.length - 1] === "\n" ? string.slice(0, -1) : string;
}
function foldString(string, width) {
  var lineRe = /(\n+)([^\n]*)/g;
  var result = (function () {
    var nextLF = string.indexOf("\n");
    nextLF = nextLF !== -1 ? nextLF : string.length;
    lineRe.lastIndex = nextLF;
    return foldLine(string.slice(0, nextLF), width);
  })();
  var prevMoreIndented = string[0] === "\n" || string[0] === " ";
  var moreIndented;
  var match;
  while (match = lineRe.exec(string)) {
    var prefix = match[1], line = match[2];
    moreIndented = line[0] === " ";
    result += prefix + (!prevMoreIndented && !moreIndented && line !== "" ? "\n" : "") + foldLine(line, width);
    prevMoreIndented = moreIndented;
  }
  return result;
}
function foldLine(line, width) {
  if (line === "" || line[0] === " ") return line;
  var breakRe = / [^ ]/g;
  var match;
  var start = 0, end, curr = 0, next = 0;
  var result = "";
  while (match = breakRe.exec(line)) {
    next = match.index;
    if (next - start > width) {
      end = curr > start ? curr : next;
      result += "\n" + line.slice(start, end);
      start = end + 1;
    }
    curr = next;
  }
  result += "\n";
  if (line.length - start > width && curr > start) {
    result += line.slice(start, curr) + "\n" + line.slice(curr + 1);
  } else {
    result += line.slice(start);
  }
  return result.slice(1);
}
function escapeString(string) {
  var result = "";
  var char = 0;
  var escapeSeq;
  for (var i = 0; i < string.length; char >= 65536 ? i += 2 : i++) {
    char = codePointAt(string, i);
    escapeSeq = ESCAPE_SEQUENCES[char];
    if (!escapeSeq && isPrintable(char)) {
      result += string[i];
      if (char >= 65536) result += string[i + 1];
    } else {
      result += escapeSeq || encodeHex(char);
    }
  }
  return result;
}
function writeFlowSequence(state, level, object) {
  var _result = "", _tag = state.tag, index, length, value;
  for (index = 0, length = object.length; index < length; index += 1) {
    value = object[index];
    if (state.replacer) {
      value = state.replacer.call(object, String(index), value);
    }
    if (writeNode(state, level, value, false, false) || typeof value === "undefined" && writeNode(state, level, null, false, false)) {
      if (_result !== "") _result += "," + (!state.condenseFlow ? " " : "");
      _result += state.dump;
    }
  }
  state.tag = _tag;
  state.dump = "[" + _result + "]";
}
function writeBlockSequence(state, level, object, compact) {
  var _result = "", _tag = state.tag, index, length, value;
  for (index = 0, length = object.length; index < length; index += 1) {
    value = object[index];
    if (state.replacer) {
      value = state.replacer.call(object, String(index), value);
    }
    if (writeNode(state, level + 1, value, true, true, false, true) || typeof value === "undefined" && writeNode(state, level + 1, null, true, true, false, true)) {
      if (!compact || _result !== "") {
        _result += generateNextLine(state, level);
      }
      if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
        _result += "-";
      } else {
        _result += "- ";
      }
      _result += state.dump;
    }
  }
  state.tag = _tag;
  state.dump = _result || "[]";
}
function writeFlowMapping(state, level, object) {
  var _result = "", _tag = state.tag, objectKeyList = Object.keys(object), index, length, objectKey, objectValue, pairBuffer;
  for (index = 0, length = objectKeyList.length; index < length; index += 1) {
    pairBuffer = "";
    if (_result !== "") pairBuffer += ", ";
    if (state.condenseFlow) pairBuffer += '"';
    objectKey = objectKeyList[index];
    objectValue = object[objectKey];
    if (state.replacer) {
      objectValue = state.replacer.call(object, objectKey, objectValue);
    }
    if (!writeNode(state, level, objectKey, false, false)) {
      continue;
    }
    if (state.dump.length > 1024) pairBuffer += "? ";
    pairBuffer += state.dump + (state.condenseFlow ? '"' : "") + ":" + (state.condenseFlow ? "" : " ");
    if (!writeNode(state, level, objectValue, false, false)) {
      continue;
    }
    pairBuffer += state.dump;
    _result += pairBuffer;
  }
  state.tag = _tag;
  state.dump = "{" + _result + "}";
}
function writeBlockMapping(state, level, object, compact) {
  var _result = "", _tag = state.tag, objectKeyList = Object.keys(object), index, length, objectKey, objectValue, explicitPair, pairBuffer;
  if (state.sortKeys === true) {
    objectKeyList.sort();
  } else if (typeof state.sortKeys === "function") {
    objectKeyList.sort(state.sortKeys);
  } else if (state.sortKeys) {
    throw new exception("sortKeys must be a boolean or a function");
  }
  for (index = 0, length = objectKeyList.length; index < length; index += 1) {
    pairBuffer = "";
    if (!compact || _result !== "") {
      pairBuffer += generateNextLine(state, level);
    }
    objectKey = objectKeyList[index];
    objectValue = object[objectKey];
    if (state.replacer) {
      objectValue = state.replacer.call(object, objectKey, objectValue);
    }
    if (!writeNode(state, level + 1, objectKey, true, true, true)) {
      continue;
    }
    explicitPair = state.tag !== null && state.tag !== "?" || state.dump && state.dump.length > 1024;
    if (explicitPair) {
      if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
        pairBuffer += "?";
      } else {
        pairBuffer += "? ";
      }
    }
    pairBuffer += state.dump;
    if (explicitPair) {
      pairBuffer += generateNextLine(state, level);
    }
    if (!writeNode(state, level + 1, objectValue, true, explicitPair)) {
      continue;
    }
    if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
      pairBuffer += ":";
    } else {
      pairBuffer += ": ";
    }
    pairBuffer += state.dump;
    _result += pairBuffer;
  }
  state.tag = _tag;
  state.dump = _result || "{}";
}
function detectType(state, object, explicit) {
  var _result, typeList, index, length, type2, style;
  typeList = explicit ? state.explicitTypes : state.implicitTypes;
  for (index = 0, length = typeList.length; index < length; index += 1) {
    type2 = typeList[index];
    if ((type2.instanceOf || type2.predicate) && (!type2.instanceOf || typeof object === "object" && object instanceof type2.instanceOf) && (!type2.predicate || type2.predicate(object))) {
      if (explicit) {
        if (type2.multi && type2.representName) {
          state.tag = type2.representName(object);
        } else {
          state.tag = type2.tag;
        }
      } else {
        state.tag = "?";
      }
      if (type2.represent) {
        style = state.styleMap[type2.tag] || type2.defaultStyle;
        if (_toString.call(type2.represent) === "[object Function]") {
          _result = type2.represent(object, style);
        } else if (_hasOwnProperty.call(type2.represent, style)) {
          _result = type2.represent[style](object, style);
        } else {
          throw new exception("!<" + type2.tag + '> tag resolver accepts not "' + style + '" style');
        }
        state.dump = _result;
      }
      return true;
    }
  }
  return false;
}
function writeNode(state, level, object, block, compact, iskey, isblockseq) {
  state.tag = null;
  state.dump = object;
  if (!detectType(state, object, false)) {
    detectType(state, object, true);
  }
  var type2 = _toString.call(state.dump);
  var inblock = block;
  var tagStr;
  if (block) {
    block = state.flowLevel < 0 || state.flowLevel > level;
  }
  var objectOrArray = type2 === "[object Object]" || type2 === "[object Array]", duplicateIndex, duplicate;
  if (objectOrArray) {
    duplicateIndex = state.duplicates.indexOf(object);
    duplicate = duplicateIndex !== -1;
  }
  if (state.tag !== null && state.tag !== "?" || duplicate || state.indent !== 2 && level > 0) {
    compact = false;
  }
  if (duplicate && state.usedDuplicates[duplicateIndex]) {
    state.dump = "*ref_" + duplicateIndex;
  } else {
    if (objectOrArray && duplicate && !state.usedDuplicates[duplicateIndex]) {
      state.usedDuplicates[duplicateIndex] = true;
    }
    if (type2 === "[object Object]") {
      if (block && Object.keys(state.dump).length !== 0) {
        writeBlockMapping(state, level, state.dump, compact);
        if (duplicate) {
          state.dump = "&ref_" + duplicateIndex + state.dump;
        }
      } else {
        writeFlowMapping(state, level, state.dump);
        if (duplicate) {
          state.dump = "&ref_" + duplicateIndex + " " + state.dump;
        }
      }
    } else if (type2 === "[object Array]") {
      if (block && state.dump.length !== 0) {
        if (state.noArrayIndent && !isblockseq && level > 0) {
          writeBlockSequence(state, level - 1, state.dump, compact);
        } else {
          writeBlockSequence(state, level, state.dump, compact);
        }
        if (duplicate) {
          state.dump = "&ref_" + duplicateIndex + state.dump;
        }
      } else {
        writeFlowSequence(state, level, state.dump);
        if (duplicate) {
          state.dump = "&ref_" + duplicateIndex + " " + state.dump;
        }
      }
    } else if (type2 === "[object String]") {
      if (state.tag !== "?") {
        writeScalar(state, state.dump, level, iskey, inblock);
      }
    } else if (type2 === "[object Undefined]") {
      return false;
    } else {
      if (state.skipInvalid) return false;
      throw new exception("unacceptable kind of an object to dump " + type2);
    }
    if (state.tag !== null && state.tag !== "?") {
      tagStr = encodeURI(
        state.tag[0] === "!" ? state.tag.slice(1) : state.tag
      ).replace(/!/g, "%21");
      if (state.tag[0] === "!") {
        tagStr = "!" + tagStr;
      } else if (tagStr.slice(0, 18) === "tag:yaml.org,2002:") {
        tagStr = "!!" + tagStr.slice(18);
      } else {
        tagStr = "!<" + tagStr + ">";
      }
      state.dump = tagStr + " " + state.dump;
    }
  }
  return true;
}
function getDuplicateReferences(object, state) {
  var objects = [], duplicatesIndexes = [], index, length;
  inspectNode(object, objects, duplicatesIndexes);
  for (index = 0, length = duplicatesIndexes.length; index < length; index += 1) {
    state.duplicates.push(objects[duplicatesIndexes[index]]);
  }
  state.usedDuplicates = new Array(length);
}
function inspectNode(object, objects, duplicatesIndexes) {
  var objectKeyList, index, length;
  if (object !== null && typeof object === "object") {
    index = objects.indexOf(object);
    if (index !== -1) {
      if (duplicatesIndexes.indexOf(index) === -1) {
        duplicatesIndexes.push(index);
      }
    } else {
      objects.push(object);
      if (Array.isArray(object)) {
        for (index = 0, length = object.length; index < length; index += 1) {
          inspectNode(object[index], objects, duplicatesIndexes);
        }
      } else {
        objectKeyList = Object.keys(object);
        for (index = 0, length = objectKeyList.length; index < length; index += 1) {
          inspectNode(object[objectKeyList[index]], objects, duplicatesIndexes);
        }
      }
    }
  }
}
function dump$1(input, options) {
  options = options || {};
  var state = new State(options);
  if (!state.noRefs) getDuplicateReferences(input, state);
  var value = input;
  if (state.replacer) {
    value = state.replacer.call({ "": value }, "", value);
  }
  if (writeNode(state, 0, value, true, true)) return state.dump + "\n";
  return "";
}
var dump_1 = dump$1;
var dumper = {
  dump: dump_1
};
function renamed(from, to) {
  return function () {
    throw new Error("Function yaml." + from + " is removed in js-yaml 4. Use yaml." + to + " instead, which is now safe by default.");
  };
}
var Type = type;
var DEFAULT_SCHEMA = _default;
var load = loader.load;
var loadAll = loader.loadAll;
var dump = dumper.dump;
var safeLoad = renamed("safeLoad", "load");
var safeLoadAll = renamed("safeLoadAll", "loadAll");
var safeDump = renamed("safeDump", "dump");

// ../../src/utils/yamlParser.ts
var parseCache = /* @__PURE__ */ new Map();
var CACHE_TTL = 5e3;
var referenceType = new Type("!reference", {
  kind: "sequence",
  construct: function (data) {
    return { reference: data };
  }
});
var GITLAB_SCHEMA = DEFAULT_SCHEMA.extend([referenceType]);
function parseYaml(text) {
  try {
    const contentHash = text.length + text.substring(0, 100) + text.substring(text.length - 100);
    const now = Date.now();
    const cached = parseCache.get(contentHash);
    if (cached && cached.content === text && now - cached.timestamp < CACHE_TTL) {
      return cached.parsed;
    }
    const parsed = load(text, { schema: GITLAB_SCHEMA });
    parseCache.set(contentHash, { content: text, parsed, timestamp: now });
    if (parseCache.size > 50) {
      cleanParseCache(now);
    }
    return parsed;
  } catch (e) {
    console.error("Error parsing YAML:", e);
    return null;
  }
}
function cleanParseCache(currentTime) {
  for (const [key, value] of parseCache.entries()) {
    if (currentTime - value.timestamp > CACHE_TTL) {
      parseCache.delete(key);
    }
  }
}

// ../../src/services/component/componentService.ts
var vscode6 = __toESM(require("vscode"));

// ../../src/utils/httpClient.ts
var https = __toESM(require("https"));
var http = __toESM(require("http"));
var vscode4 = __toESM(require("vscode"));

// ../../src/utils/logger.ts
var vscode2 = __toESM(require("vscode"));

// ../../src/utils/outputChannel.ts
var vscode = __toESM(require("vscode"));
var outputChannel = vscode.window.createOutputChannel("GitLab Component Helper");

// ../../src/utils/logger.ts
var LogLevel = /* @__PURE__ */ ((LogLevel2) => {
  LogLevel2[LogLevel2["DEBUG"] = 0] = "DEBUG";
  LogLevel2[LogLevel2["INFO"] = 1] = "INFO";
  LogLevel2[LogLevel2["WARN"] = 2] = "WARN";
  LogLevel2[LogLevel2["ERROR"] = 3] = "ERROR";
  return LogLevel2;
})(LogLevel || {});
var Logger = class _Logger {
  constructor() {
    this.currentLevel = 3 /* ERROR */;
    this.isInitialized = false;
    this.isDevelopmentMode = false;
    this.isDevelopmentMode = this.isInDevelopmentMode();
    this.updateLogLevel(false);
    vscode2.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("gitlabComponentHelper.logLevel") || e.affectsConfiguration("gitlabComponentHelper.autoShowOutput")) {
        this.updateLogLevel(!this.isDevelopmentMode);
      }
    });
    this.isInitialized = true;
  }
  isInDevelopmentMode() {
    try {
      const extensionPath = vscode2.extensions.getExtension("efailution.gitlab-component-helper")?.extensionPath;
      return Boolean(
        // Check for common development indicators
        process.env.NODE_ENV === "development" || extensionPath?.includes("src") || extensionPath?.includes(".vscode") || // Extension development path typically includes the workspace folder
        extensionPath?.includes("gitlab-component-helper")
      );
    } catch {
      return false;
    }
  }
  static getInstance() {
    if (!_Logger.instance) {
      _Logger.instance = new _Logger();
    }
    return _Logger.instance;
  }
  updateLogLevel(showOutput = false) {
    const config = vscode2.workspace.getConfiguration("gitlabComponentHelper");
    const levelString = config.get("logLevel", "ERROR");
    const autoShowOutput = config.get("autoShowOutput", false);
    const normalizedLevel = levelString.toUpperCase();
    let newLevel;
    switch (normalizedLevel) {
      case "DEBUG":
        newLevel = 0 /* DEBUG */;
        break;
      case "INFO":
        newLevel = 1 /* INFO */;
        break;
      case "WARN":
        newLevel = 2 /* WARN */;
        break;
      case "ERROR":
        newLevel = 3 /* ERROR */;
        break;
      default:
        newLevel = 1 /* INFO */;
        break;
    }
    this.currentLevel = newLevel;
    if (showOutput && !this.isDevelopmentMode && autoShowOutput) {
      outputChannel.show(true);
    }
    const levelName = LogLevel[this.currentLevel];
    const devMode = this.isDevelopmentMode ? " [DEV MODE]" : "";
    const msg = `[Logger] Log level updated to: ${levelString} (normalized: ${normalizedLevel}, actual: ${levelName}, numeric: ${this.currentLevel})${devMode}`;
    outputChannel.appendLine(msg);
  }
  // Public method to explicitly show output channel (for commands that need it)
  showOutput() {
    outputChannel.show(true);
  }
  shouldLog(level) {
    return level >= this.currentLevel;
  }
  formatMessage(level, component, message) {
    const timestamp2 = (/* @__PURE__ */ new Date()).toISOString();
    return `[${timestamp2}] [${level}] [${component}] ${message}`;
  }
  debug(message, component = "ComponentService") {
    if (this.shouldLog(0 /* DEBUG */)) {
      const formatted = this.formatMessage("DEBUG", component, message);
      outputChannel.appendLine(formatted);
    }
  }
  info(message, component = "ComponentService") {
    if (this.shouldLog(1 /* INFO */)) {
      const formatted = this.formatMessage("INFO", component, message);
      outputChannel.appendLine(formatted);
    }
  }
  warn(message, component = "ComponentService") {
    if (this.shouldLog(2 /* WARN */)) {
      const formatted = this.formatMessage("WARN", component, message);
      outputChannel.appendLine(formatted);
      console.warn(formatted);
    }
  }
  error(message, component = "ComponentService") {
    if (this.shouldLog(3 /* ERROR */)) {
      const formatted = this.formatMessage("ERROR", component, message);
      outputChannel.appendLine(formatted);
      console.error(formatted);
    }
  }
  // Performance timing utilities
  time(label) {
    if (this.shouldLog(0 /* DEBUG */)) {
      console.time(`[ComponentService] ${label}`);
    }
  }
  timeEnd(label) {
    if (this.shouldLog(0 /* DEBUG */)) {
      console.timeEnd(`[ComponentService] ${label}`);
    }
  }
  // Structured logging for performance metrics
  logPerformance(operation, duration, details) {
    if (this.shouldLog(1 /* INFO */)) {
      const detailsStr = details ? ` | ${JSON.stringify(details)}` : "";
      this.info(`Performance: ${operation} completed in ${duration}ms${detailsStr}`, "Performance");
    }
  }
};

// ../../src/utils/requestDeduplicator.ts
var RequestDeduplicator = class {
  constructor() {
    this.pendingRequests = /* @__PURE__ */ new Map();
  }
  /**
   * Fetch data with deduplication.
   * If a request with the same key is already pending, returns the existing promise.
   * Otherwise, executes the fetcher function and caches the promise.
   *
   * @param key Unique identifier for the request (e.g., URL + auth token)
   * @param fetcher Function that performs the actual fetch
   * @returns Promise that resolves to the fetched data
   */
  async fetch(key, fetcher) {
    const existing = this.pendingRequests.get(key);
    if (existing) {
      return existing.promise;
    }
    const promise = fetcher().then((result) => {
      this.pendingRequests.delete(key);
      return result;
    }).catch((error) => {
      this.pendingRequests.delete(key);
      throw error;
    });
    this.pendingRequests.set(key, {
      promise,
      timestamp: Date.now()
    });
    return promise;
  }
  /**
   * Clear all pending requests.
   * Useful for cleanup or reset scenarios.
   */
  clear() {
    this.pendingRequests.clear();
  }
  /**
   * Get statistics about pending requests.
   *
   * @returns Object containing pending request count and keys
   */
  getStats() {
    return {
      pendingCount: this.pendingRequests.size,
      pendingKeys: Array.from(this.pendingRequests.keys())
    };
  }
  /**
   * Clean up stale requests that have been pending for too long.
   * This is a safety mechanism to prevent memory leaks from stuck promises.
   *
   * @param maxAgeMs Maximum age in milliseconds (default: 5 minutes)
   */
  cleanupStale(maxAgeMs = 5 * 60 * 1e3) {
    const now = Date.now();
    const staleKeys = [];
    this.pendingRequests.forEach((request, key) => {
      if (now - request.timestamp > maxAgeMs) {
        staleKeys.push(key);
      }
    });
    staleKeys.forEach((key) => this.pendingRequests.delete(key));
  }
};
var instance = null;
function getRequestDeduplicator() {
  if (!instance) {
    instance = new RequestDeduplicator();
  }
  return instance;
}

// ../../src/utils/performanceMonitor.ts
var SLOW_OPERATION_THRESHOLD_MS = 1e3;
var MAX_METRICS_HISTORY = 1e3;
var PerformanceMonitor = class {
  constructor() {
    this.logger = Logger.getInstance();
    this.metrics = /* @__PURE__ */ new Map();
  }
  /**
   * Track an async operation and record its performance metrics.
   * Automatically warns if operation exceeds slow threshold.
   */
  async track(name, fn, metadata) {
    const startTime = Date.now();
    try {
      const result = await fn();
      const duration = Date.now() - startTime;
      this.recordMetric(name, duration, metadata);
      if (duration > SLOW_OPERATION_THRESHOLD_MS) {
        this.logger.warn(
          `[Performance] Slow operation detected: ${name} took ${duration}ms (threshold: ${SLOW_OPERATION_THRESHOLD_MS}ms)`,
          "PerformanceMonitor"
        );
        if (metadata) {
          this.logger.debug(
            `[Performance] Operation metadata: ${JSON.stringify(metadata)}`,
            "PerformanceMonitor"
          );
        }
      }
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.recordMetric(name, duration, { ...metadata, error: true });
      throw error;
    }
  }
  /**
   * Track a synchronous operation and record its performance metrics.
   * Automatically warns if operation exceeds slow threshold.
   */
  trackSync(name, fn, metadata) {
    const startTime = Date.now();
    try {
      const result = fn();
      const duration = Date.now() - startTime;
      this.recordMetric(name, duration, metadata);
      if (duration > SLOW_OPERATION_THRESHOLD_MS) {
        this.logger.warn(
          `[Performance] Slow operation detected: ${name} took ${duration}ms (threshold: ${SLOW_OPERATION_THRESHOLD_MS}ms)`,
          "PerformanceMonitor"
        );
        if (metadata) {
          this.logger.debug(
            `[Performance] Operation metadata: ${JSON.stringify(metadata)}`,
            "PerformanceMonitor"
          );
        }
      }
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.recordMetric(name, duration, { ...metadata, error: true });
      throw error;
    }
  }
  /**
   * Record a metric for an operation.
   */
  recordMetric(name, duration, metadata) {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }
    const metrics = this.metrics.get(name);
    metrics.push({
      name,
      duration,
      timestamp: Date.now(),
      metadata
    });
    if (metrics.length > MAX_METRICS_HISTORY) {
      metrics.shift();
    }
  }
  /**
   * Get statistics for a specific operation.
   */
  getStats(name) {
    const metrics = this.metrics.get(name);
    if (!metrics || metrics.length === 0) {
      return null;
    }
    const durations = metrics.map((m) => m.duration).sort((a, b) => a - b);
    const count = durations.length;
    const totalDuration = durations.reduce((sum, d) => sum + d, 0);
    const avgDuration = totalDuration / count;
    return {
      name,
      count,
      totalDuration,
      avgDuration,
      minDuration: durations[0],
      maxDuration: durations[count - 1],
      medianDuration: this.calculatePercentile(durations, 50),
      p95Duration: this.calculatePercentile(durations, 95),
      p99Duration: this.calculatePercentile(durations, 99),
      recentMetrics: metrics.slice(-10)
      // Last 10 metrics
    };
  }
  /**
   * Get all statistics for all tracked operations.
   */
  getAllStats() {
    const stats = [];
    for (const name of this.metrics.keys()) {
      const stat = this.getStats(name);
      if (stat) {
        stats.push(stat);
      }
    }
    return stats.sort((a, b) => b.avgDuration - a.avgDuration);
  }
  /**
   * Get the N slowest operations by average duration.
   */
  getSlowestOperations(limit = 10) {
    const allStats = this.getAllStats();
    return allStats.slice(0, limit);
  }
  /**
   * Export all metrics for external analysis.
   */
  exportMetrics() {
    const allMetrics = [];
    for (const metrics of this.metrics.values()) {
      allMetrics.push(...metrics);
    }
    return {
      operations: Array.from(this.metrics.keys()),
      metrics: allMetrics.sort((a, b) => a.timestamp - b.timestamp)
    };
  }
  /**
   * Clear all recorded metrics.
   */
  clear() {
    this.metrics.clear();
    this.logger.info("[Performance] Cleared all performance metrics", "PerformanceMonitor");
  }
  /**
   * Calculate percentile from sorted array of values.
   */
  calculatePercentile(sortedValues, percentile) {
    if (sortedValues.length === 0) {
      return 0;
    }
    const index = Math.ceil(percentile / 100 * sortedValues.length) - 1;
    return sortedValues[Math.max(0, index)];
  }
  /**
   * Get a summary of performance metrics as a formatted string.
   */
  getSummary() {
    const stats = this.getAllStats();
    if (stats.length === 0) {
      return "No performance metrics recorded yet.";
    }
    let summary = "=== Performance Metrics Summary ===\n\n";
    for (const stat of stats) {
      summary += `Operation: ${stat.name}
`;
      summary += `  Count: ${stat.count}
`;
      summary += `  Average: ${stat.avgDuration.toFixed(2)}ms
`;
      summary += `  Min: ${stat.minDuration}ms
`;
      summary += `  Max: ${stat.maxDuration}ms
`;
      summary += `  Median: ${stat.medianDuration.toFixed(2)}ms
`;
      summary += `  P95: ${stat.p95Duration.toFixed(2)}ms
`;
      summary += `  P99: ${stat.p99Duration.toFixed(2)}ms
`;
      if (stat.avgDuration > SLOW_OPERATION_THRESHOLD_MS) {
        summary += `  \u26A0\uFE0F  SLOW OPERATION (avg > ${SLOW_OPERATION_THRESHOLD_MS}ms)
`;
      }
      summary += "\n";
    }
    return summary;
  }
};
var performanceMonitor = null;
function getPerformanceMonitor() {
  if (!performanceMonitor) {
    performanceMonitor = new PerformanceMonitor();
  }
  return performanceMonitor;
}

// ../../src/errors/types.ts
var GitLabComponentError = class extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "GitLabComponentError";
    this.code = code;
    this.details = options.details;
    this.recoverable = options.recoverable ?? false;
    this.userMessage = options.userMessage || this.getDefaultUserMessage(code);
    if (options.cause) {
      this.stack = `${this.stack}
Caused by: ${options.cause.stack}`;
    }
  }
  getDefaultUserMessage(code) {
    switch (code) {
      case "NETWORK_ERROR" /* NETWORK_ERROR */:
        return "Network connection failed. Please check your internet connection.";
      case "TIMEOUT" /* TIMEOUT */:
        return "Request timed out. The GitLab server may be slow or unreachable.";
      case "RATE_LIMIT" /* RATE_LIMIT */:
        return "Rate limit exceeded. Please wait a moment before trying again.";
      case "UNAUTHORIZED" /* UNAUTHORIZED */:
        return "Authentication failed. Please check your GitLab token.";
      case "NOT_FOUND" /* NOT_FOUND */:
        return "Resource not found. The component or project may not exist.";
      case "SERVER_ERROR" /* SERVER_ERROR */:
        return "GitLab server error. Please try again later.";
      case "INVALID_YAML" /* INVALID_YAML */:
        return "Invalid YAML syntax in component specification.";
      case "INVALID_SPEC" /* INVALID_SPEC */:
        return "Component specification is invalid or incomplete.";
      case "PARSE_ERROR" /* PARSE_ERROR */:
        return "Failed to parse component data.";
      case "CACHE_READ_ERROR" /* CACHE_READ_ERROR */:
        return "Failed to read from cache. Cache will be rebuilt.";
      case "CACHE_WRITE_ERROR" /* CACHE_WRITE_ERROR */:
        return "Failed to write to cache. Changes may not persist.";
      case "COMPONENT_NOT_FOUND" /* COMPONENT_NOT_FOUND */:
        return "Component not found in the specified location.";
      case "INVALID_COMPONENT_PATH" /* INVALID_COMPONENT_PATH */:
        return "Invalid component path format.";
      case "VERSION_NOT_FOUND" /* VERSION_NOT_FOUND */:
        return "Specified version not found for this component.";
      case "MISSING_TOKEN" /* MISSING_TOKEN */:
        return "GitLab token not configured. Please add your token in settings.";
      case "INVALID_CONFIG" /* INVALID_CONFIG */:
        return "Extension configuration is invalid. Please check your settings.";
      case "OPERATION_CANCELLED" /* OPERATION_CANCELLED */:
        return "Operation was cancelled.";
      default:
        return "An unexpected error occurred. Please try again.";
    }
  }
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      userMessage: this.userMessage,
      recoverable: this.recoverable,
      details: this.details
    };
  }
};
var NetworkError = class _NetworkError extends GitLabComponentError {
  constructor(message, options = {}) {
    const code = options.statusCode ? _NetworkError.codeFromStatus(options.statusCode) : "NETWORK_ERROR" /* NETWORK_ERROR */;
    super(code, message, {
      details: { statusCode: options.statusCode },
      recoverable: code !== "UNAUTHORIZED" /* UNAUTHORIZED */,
      cause: options.cause
    });
  }
  static codeFromStatus(statusCode) {
    if (statusCode === 401 || statusCode === 403) {
      return "UNAUTHORIZED" /* UNAUTHORIZED */;
    }
    if (statusCode === 404) {
      return "NOT_FOUND" /* NOT_FOUND */;
    }
    if (statusCode === 429) {
      return "RATE_LIMIT" /* RATE_LIMIT */;
    }
    if (statusCode >= 500) {
      return "SERVER_ERROR" /* SERVER_ERROR */;
    }
    return "NETWORK_ERROR" /* NETWORK_ERROR */;
  }
};
var ParseError = class extends GitLabComponentError {
  constructor(message, options = {}) {
    super("PARSE_ERROR" /* PARSE_ERROR */, message, {
      details: { yaml: options.yaml },
      recoverable: false,
      cause: options.cause
    });
  }
};

// ../../src/errors/handler.ts
var vscode3 = __toESM(require("vscode"));
var ErrorHandler = class _ErrorHandler {
  constructor() {
    this.logger = Logger.getInstance();
  }
  static getInstance() {
    if (!_ErrorHandler.instance) {
      _ErrorHandler.instance = new _ErrorHandler();
    }
    return _ErrorHandler.instance;
  }
  /**
   * Handle an error with consistent logging and user notification
   */
  async handle(error, options = {}) {
    const {
      showNotification = true,
      logError = true,
      throwError: throwError2 = false,
      fallbackValue,
      context
    } = options;
    const gitlabError = this.normalizeError(error, context);
    if (logError) {
      this.logError(gitlabError, context);
    }
    if (showNotification) {
      await this.showErrorNotification(gitlabError);
    }
    if (throwError2) {
      throw gitlabError;
    }
    return fallbackValue;
  }
  /**
   * Wrap an async operation with error handling
   */
  async wrap(operation, options = {}) {
    try {
      return await operation();
    } catch (error) {
      return this.handle(error, options);
    }
  }
  /**
   * Wrap a sync operation with error handling
   */
  wrapSync(operation, options = {}) {
    try {
      return operation();
    } catch (error) {
      this.handle(error, options);
      return options.fallbackValue;
    }
  }
  /**
   * Convert unknown error to GitLabComponentError
   */
  normalizeError(error, context) {
    if (error instanceof GitLabComponentError) {
      return error;
    }
    if (error instanceof Error) {
      if (this.isNetworkError(error)) {
        return new NetworkError(error.message, { cause: error });
      }
      if (this.isTimeoutError(error)) {
        return new GitLabComponentError(
          "TIMEOUT" /* TIMEOUT */,
          error.message,
          { cause: error, recoverable: true }
        );
      }
      if (this.isYAMLError(error)) {
        return new GitLabComponentError(
          "INVALID_YAML" /* INVALID_YAML */,
          error.message,
          { cause: error, recoverable: false }
        );
      }
      const message = context ? `${context}: ${error.message}` : error.message;
      return new GitLabComponentError(
        "UNKNOWN_ERROR" /* UNKNOWN_ERROR */,
        message,
        { cause: error, recoverable: false }
      );
    }
    return new GitLabComponentError(
      "UNKNOWN_ERROR" /* UNKNOWN_ERROR */,
      String(error),
      { recoverable: false }
    );
  }
  /**
   * Log error with appropriate level
   */
  logError(error, context) {
    const prefix = context ? `[${context}]` : "";
    const message = `${prefix} ${error.code}: ${error.message}`;
    if (error.recoverable) {
      this.logger.warn(message, error.details);
    } else {
      this.logger.error(message, error.details);
    }
    if (error.stack) {
      this.logger.debug(error.stack);
    }
  }
  /**
   * Show error notification to user
   */
  async showErrorNotification(error) {
    const actions = this.getErrorActions(error);
    if (error.recoverable) {
      const selection = await vscode3.window.showWarningMessage(
        error.userMessage,
        ...actions
      );
      await this.handleAction(selection, error);
    } else {
      const selection = await vscode3.window.showErrorMessage(
        error.userMessage,
        ...actions
      );
      await this.handleAction(selection, error);
    }
  }
  /**
   * Get contextual actions for error
   */
  getErrorActions(error) {
    const actions = [];
    switch (error.code) {
      case "UNAUTHORIZED" /* UNAUTHORIZED */:
      case "MISSING_TOKEN" /* MISSING_TOKEN */:
        actions.push("Configure Token", "Open Settings");
        break;
      case "RATE_LIMIT" /* RATE_LIMIT */:
        actions.push("Retry Later");
        break;
      case "NETWORK_ERROR" /* NETWORK_ERROR */:
      case "TIMEOUT" /* TIMEOUT */:
        actions.push("Retry", "Check Connection");
        break;
      case "COMPONENT_NOT_FOUND" /* COMPONENT_NOT_FOUND */:
        actions.push("Browse Components");
        break;
      case "CACHE_CORRUPTION" /* CACHE_CORRUPTION */:
      case "CACHE_READ_ERROR" /* CACHE_READ_ERROR */:
        actions.push("Reset Cache");
        break;
      case "INVALID_CONFIG" /* INVALID_CONFIG */:
        actions.push("Open Settings");
        break;
      default:
        actions.push("View Logs");
    }
    return actions;
  }
  /**
   * Handle user action selection
   */
  async handleAction(action, error) {
    if (!action) {
      return;
    }
    switch (action) {
      case "Configure Token":
        await vscode3.commands.executeCommand("gitlabComponentHelper.addProjectToken");
        break;
      case "Open Settings":
        await vscode3.commands.executeCommand(
          "workbench.action.openSettings",
          "gitlabComponentHelper"
        );
        break;
      case "Reset Cache":
        await vscode3.commands.executeCommand("gitlab-component-helper.resetCache");
        break;
      case "Browse Components":
        await vscode3.commands.executeCommand("gitlab-component-helper.browseComponents");
        break;
      case "View Logs":
        this.logger.showOutput();
        break;
      case "Retry":
        break;
    }
  }
  /**
   * Check if error is a network error
   */
  isNetworkError(error) {
    const message = error.message.toLowerCase();
    return message.includes("network") || message.includes("econnrefused") || message.includes("enotfound") || message.includes("econnreset") || message.includes("http");
  }
  /**
   * Check if error is a timeout error
   */
  isTimeoutError(error) {
    const message = error.message.toLowerCase();
    return message.includes("timeout") || message.includes("etimedout");
  }
  /**
   * Check if error is a YAML parsing error
   */
  isYAMLError(error) {
    return error.name === "YAMLException" || error.name === "YAMLParseError" || error.message.includes("YAML");
  }
  /**
   * Create error from HTTP status code
   */
  createHttpError(statusCode, message) {
    const defaultMessage = message || `HTTP ${statusCode} error`;
    return new NetworkError(defaultMessage, { statusCode });
  }
  /**
   * Check if error is recoverable
   */
  isRecoverable(error) {
    if (error instanceof GitLabComponentError) {
      return error.recoverable;
    }
    return false;
  }
  /**
   * Format error for display
   */
  formatError(error) {
    const gitlabError = this.normalizeError(error);
    return `${gitlabError.code}: ${gitlabError.userMessage}`;
  }
};
function getErrorHandler() {
  return ErrorHandler.getInstance();
}

// ../../src/utils/httpClient.ts
var HttpClient = class {
  constructor() {
    this.logger = Logger.getInstance();
    this.performanceMonitor = getPerformanceMonitor();
    this.deduplicator = getRequestDeduplicator();
  }
  getConfig() {
    const config = vscode4.workspace.getConfiguration("gitlabComponentHelper");
    return {
      timeout: config.get("httpTimeout", 1e4),
      retryAttempts: config.get("retryAttempts", 3)
    };
  }
  async delay(ms) {
    return new Promise((resolve2) => setTimeout(resolve2, ms));
  }
  shouldRetry(statusCode) {
    return statusCode >= 500 || statusCode === 429;
  }
  buildCacheKey(url, headers) {
    const authToken = headers["Authorization"] || headers["PRIVATE-TOKEN"] || "";
    return `${url}|${authToken}`;
  }
  async fetchJson(url, options = {}) {
    return this.performanceMonitor.track(
      "httpClient.fetchJson",
      async () => {
        return this.fetchJsonInternal(url, options);
      },
      { url: new URL(url).hostname + new URL(url).pathname }
    );
  }
  async fetchJsonInternal(url, options = {}) {
    const config = this.getConfig();
    const timeout = options.timeout || config.timeout;
    const retryAttempts = options.retryAttempts || config.retryAttempts;
    const headers = {
      "User-Agent": "VSCode-GitLabComponentHelper",
      ...options.headers
    };
    const cacheKey = this.buildCacheKey(url, headers);
    return this.deduplicator.fetch(cacheKey, async () => {
      for (let attempt = 0; attempt <= retryAttempts; attempt++) {
        try {
          this.logger.debug(`HTTP Request attempt ${attempt + 1}/${retryAttempts + 1}: ${url}`);
          const data = await this.makeRequest(url, { timeout, headers });
          try {
            const jsonData = JSON.parse(data);
            this.logger.debug(`HTTP Request successful: ${url} (${data.length} chars)`);
            return jsonData;
          } catch (parseError) {
            throw new NetworkError(
              `Invalid JSON response from ${url}`,
              { statusCode: 0, cause: parseError }
            );
          }
        } catch (error) {
          const isLastAttempt = attempt === retryAttempts;
          const statusCode = error instanceof NetworkError && error.details?.statusCode ? error.details.statusCode : error.statusCode;
          if (statusCode && !this.shouldRetry(statusCode)) {
            this.logger.warn(`HTTP Request failed with client error ${statusCode}: ${url}`);
            throw error;
          }
          if (isLastAttempt) {
            this.logger.error(`HTTP Request failed after ${retryAttempts + 1} attempts: ${url} - ${error.message}`);
            throw error;
          }
          const baseDelay = options.retryDelay || 1e3;
          const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1e3;
          this.logger.warn(`HTTP Request failed (attempt ${attempt + 1}), retrying in ${delay}ms: ${url} - ${error.message}`);
          await this.delay(delay);
        }
      }
      throw new NetworkError("Unexpected error in retry loop");
    });
  }
  async fetchText(url, options = {}) {
    return this.performanceMonitor.track(
      "httpClient.fetchText",
      async () => {
        return this.fetchTextInternal(url, options);
      },
      { url: new URL(url).hostname + new URL(url).pathname }
    );
  }
  async fetchTextInternal(url, options = {}) {
    const config = this.getConfig();
    const timeout = options.timeout || config.timeout;
    const retryAttempts = options.retryAttempts || config.retryAttempts;
    const headers = {
      "User-Agent": "VSCode-GitLabComponentHelper",
      ...options.headers
    };
    const cacheKey = this.buildCacheKey(url, headers);
    return this.deduplicator.fetch(cacheKey, async () => {
      for (let attempt = 0; attempt <= retryAttempts; attempt++) {
        try {
          this.logger.debug(`HTTP Text Request attempt ${attempt + 1}/${retryAttempts + 1}: ${url}`);
          const data = await this.makeRequest(url, { timeout, headers });
          this.logger.debug(`HTTP Text Request successful: ${url} (${data.length} chars)`);
          return data;
        } catch (error) {
          const isLastAttempt = attempt === retryAttempts;
          const statusCode = error instanceof NetworkError && error.details?.statusCode ? error.details.statusCode : error.statusCode;
          if (statusCode && !this.shouldRetry(statusCode)) {
            this.logger.warn(`HTTP Text Request failed with client error ${statusCode}: ${url}`);
            throw error;
          }
          if (isLastAttempt) {
            this.logger.error(`HTTP Text Request failed after ${retryAttempts + 1} attempts: ${url} - ${error.message}`);
            throw error;
          }
          const baseDelay = options.retryDelay || 1e3;
          const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1e3;
          this.logger.warn(`HTTP Text Request failed (attempt ${attempt + 1}), retrying in ${delay}ms: ${url} - ${error.message}`);
          await this.delay(delay);
        }
      }
      throw new NetworkError("Unexpected error in retry loop");
    });
  }
  makeRequest(url, options) {
    return new Promise((resolve2, reject) => {
      try {
        const urlObj = new URL(url);
        const isHttps = urlObj.protocol === "https:";
        const client = isHttps ? https : http;
        const requestOptions = {
          hostname: urlObj.hostname,
          port: urlObj.port || (isHttps ? 443 : 80),
          path: urlObj.pathname + urlObj.search,
          method: "GET",
          headers: options.headers,
          timeout: options.timeout
        };
        const req = client.request(requestOptions, (res) => {
          let data = "";
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve2(data);
            } else {
              const message = `HTTP ${res.statusCode}: ${data.substring(0, 200)}`;
              reject(new NetworkError(message, { statusCode: res.statusCode }));
            }
          });
        });
        req.on("timeout", () => {
          req.destroy();
          const handler = getErrorHandler();
          reject(handler.createHttpError(408, `Request timeout after ${options.timeout}ms for ${url}`));
        });
        req.on("error", (error) => {
          reject(new NetworkError(error.message, { cause: error }));
        });
        req.end();
      } catch (error) {
        reject(new NetworkError(
          error instanceof Error ? error.message : String(error),
          { cause: error }
        ));
      }
    });
  }
  // Parallel request utility
  async fetchParallel(requests, parser = (data) => JSON.parse(data)) {
    const promises2 = requests.map(async ({ url, options = {} }) => {
      try {
        const data = await this.makeRequest(url, {
          timeout: options.timeout || this.getConfig().timeout,
          headers: {
            "User-Agent": "VSCode-GitLabComponentHelper",
            ...options.headers
          }
        });
        const result = parser(data, url);
        return { result, url };
      } catch (error) {
        return { error, url };
      }
    });
    return Promise.all(promises2);
  }
  // Batch processing utility
  async processBatch(items, processor, batchSize = 5) {
    const results = [];
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      this.logger.debug(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(items.length / batchSize)} (${batch.length} items)`);
      const batchResults = await Promise.all(
        batch.map((item) => processor(item))
      );
      results.push(...batchResults);
    }
    return results;
  }
  // Get request deduplication statistics
  getDeduplicationStats() {
    return this.deduplicator.getStats();
  }
  // Clear all pending deduplicated requests
  clearDeduplicatedRequests() {
    this.deduplicator.clear();
  }
};

// ../../src/services/component/tokenManager.ts
var TokenManager = class {
  constructor() {
    this.logger = Logger.getInstance();
  }
  setSecretStorage(secretStorage) {
    this.secretStorage = secretStorage;
  }
  /**
   * Get token for a specific GitLab project
   * @param gitlabInstance The GitLab instance hostname (e.g., 'gitlab.com')
   * @param projectPath The project path (not currently used, but kept for API compatibility)
   */
  async getTokenForProject(gitlabInstance, projectPath) {
    if (!this.secretStorage) {
      this.logger.debug(`No secretStorage available for ${gitlabInstance}`);
      return void 0;
    }
    const key = `gitlab-token-${gitlabInstance}`;
    this.logger.debug(`Looking for token with key: ${key}`);
    const token = await this.secretStorage.get(key);
    this.logger.debug(`Found token for ${gitlabInstance}: ${token ? "YES" : "NO"}`);
    return token;
  }
  /**
   * Store token for a specific GitLab project
   * @param gitlabInstance The GitLab instance hostname
   * @param projectPath The project path (not currently used, but kept for API compatibility)
   * @param token The personal access token to store
   */
  async setTokenForProject(gitlabInstance, projectPath, token) {
    if (!this.secretStorage) {
      throw new Error("SecretStorage not available");
    }
    const key = `gitlab-token-${gitlabInstance}`;
    this.logger.debug(`Storing token with key: ${key}`);
    await this.secretStorage.store(key, token);
    this.logger.debug(`Token stored successfully for ${gitlabInstance}`);
  }
  /**
   * Get token for any GitLab instance (convenience method)
   * @param gitlabInstance The GitLab instance hostname
   */
  async getTokenForInstance(gitlabInstance) {
    if (!this.secretStorage) {
      return void 0;
    }
    const key = `gitlab-token-${gitlabInstance}`;
    return await this.secretStorage.get(key);
  }
};

// ../../src/services/component/urlParser.ts
var UrlParser = class {
  constructor() {
    this.logger = Logger.getInstance();
  }
  /**
   * Parse a custom GitLab component URL
   * Handles URLs like: https://gitlab.com/components/proj/proj-template@1.0.0
   * @param url The GitLab component URL to parse
   * @returns Parsed URL components or null if invalid
   */
  parseCustomComponentUrl(url) {
    try {
      const urlObj = new URL(url);
      const gitlabInstance = urlObj.hostname;
      const pathParts = urlObj.pathname.split("/").filter(Boolean);
      if (pathParts.length < 2) {
        return null;
      }
      const lastPart = pathParts[pathParts.length - 1];
      let name;
      let version;
      let path2;
      if (lastPart.includes("@")) {
        [name, version] = lastPart.split("@");
        path2 = pathParts.slice(0, pathParts.length - 1).join("/");
      } else if (pathParts.length >= 3) {
        name = lastPart;
        path2 = pathParts.slice(0, pathParts.length - 1).join("/");
      } else {
        name = "main";
        version = "main";
        path2 = pathParts.join("/");
      }
      this.logger.debug(
        `Parsed component URL: ${gitlabInstance}/${path2}/${name}${version ? `@${version}` : ""}`,
        "UrlParser"
      );
      return { gitlabInstance, path: path2, name, version };
    } catch (e) {
      this.logger.error(`Error parsing component URL: ${e}`, "UrlParser");
      return null;
    }
  }
  /**
   * Clean GitLab instance URL by removing protocol prefix
   * @param gitlabInstance The GitLab instance URL (may contain protocol)
   * @returns Clean hostname without protocol
   */
  cleanGitLabInstance(gitlabInstance) {
    let clean = gitlabInstance;
    if (clean.startsWith("https://")) {
      clean = clean.replace("https://", "");
    }
    if (clean.startsWith("http://")) {
      clean = clean.replace("http://", "");
    }
    return clean;
  }
};

// ../../src/services/component/versionManager.ts
var VersionManager = class {
  constructor(httpClient, tokenManager) {
    this.logger = Logger.getInstance();
    this.httpClient = httpClient;
    this.tokenManager = tokenManager;
  }
  /**
   * Fetch all tags/versions for a GitLab project with optimizations
   * @param gitlabInstance The GitLab instance hostname
   * @param projectPath The project path
   * @returns Array of version strings (tags and important branches)
   */
  async fetchProjectVersions(gitlabInstance, projectPath) {
    const startTime = Date.now();
    try {
      const apiBaseUrl = `https://${gitlabInstance}/api/v4`;
      const encodedPath = encodeURIComponent(projectPath);
      this.logger.info(`Fetching versions for ${gitlabInstance}/${projectPath}`);
      const token = await this.tokenManager.getTokenForProject(gitlabInstance, projectPath);
      const fetchOptions = token ? { headers: { "PRIVATE-TOKEN": token } } : void 0;
      this.logger.debug(`Using token for versions fetch: ${token ? "YES" : "NO"}`);
      const projectInfo = await this.httpClient.fetchJson(
        `${apiBaseUrl}/projects/${encodedPath}`,
        fetchOptions
      );
      if (!projectInfo || !projectInfo.id) {
        this.logger.warn(`Could not get project info for ${projectPath}`);
        return ["main"];
      }
      const [tagsResult, branchesResult] = await Promise.allSettled([
        this.httpClient.fetchJson(
          `${apiBaseUrl}/projects/${projectInfo.id}/repository/tags?per_page=100&sort=desc`,
          fetchOptions
        ),
        this.httpClient.fetchJson(
          `${apiBaseUrl}/projects/${projectInfo.id}/repository/branches?per_page=20`,
          fetchOptions
        )
      ]);
      const versions = [];
      if (tagsResult.status === "fulfilled" && Array.isArray(tagsResult.value)) {
        const tagVersions = tagsResult.value.map((tag) => tag.name).filter((name) => name);
        versions.push(...tagVersions);
        this.logger.debug(`Found ${tagVersions.length} tags`);
      } else {
        this.logger.warn(
          `Error fetching tags: ${tagsResult.status === "rejected" ? tagsResult.reason : "Unknown error"}`
        );
      }
      if (branchesResult.status === "fulfilled" && Array.isArray(branchesResult.value)) {
        const importantBranches = branchesResult.value.map((branch) => branch.name).filter((name) => ["main", "master", "develop", "dev"].includes(name));
        versions.push(...importantBranches);
        this.logger.debug(`Found ${importantBranches.length} important branches`);
      } else {
        this.logger.warn(
          `Error fetching branches: ${branchesResult.status === "rejected" ? branchesResult.reason : "Unknown error"}`
        );
      }
      const uniqueVersions = Array.from(new Set(versions));
      const sortedVersions = this.sortVersionsByPriority(uniqueVersions);
      const result = sortedVersions.length > 0 ? sortedVersions : ["main"];
      this.logger.info(
        `Returning ${result.length} versions: ${result.slice(0, 5).join(", ")}${result.length > 5 ? "..." : ""}`
      );
      this.logger.logPerformance("fetchProjectVersions", Date.now() - startTime, {
        projectPath,
        versionCount: result.length
      });
      return result;
    } catch (error) {
      this.logger.error(`Error fetching project versions: ${error}`);
      return ["main"];
    }
  }
  /**
   * Fetch all tags for a GitLab project
   * @param gitlabInstance The GitLab instance hostname
   * @param projectPath The project path
   * @returns Array of tag objects with name and commit info
   */
  async fetchProjectTags(gitlabInstance, projectPath) {
    const startTime = Date.now();
    this.logger.info(`Fetching tags for ${gitlabInstance}/${projectPath}`);
    try {
      const apiUrl = `https://${gitlabInstance}/api/v4/projects/${encodeURIComponent(
        projectPath
      )}/repository/tags?per_page=100&order_by=updated&sort=desc`;
      const token = await this.tokenManager.getTokenForProject(gitlabInstance, projectPath);
      const options = token ? { headers: { "PRIVATE-TOKEN": token } } : void 0;
      const tags = await this.httpClient.fetchJson(apiUrl, options);
      this.logger.info(`Found ${tags.length} tags for ${projectPath}`);
      this.logger.logPerformance("fetchProjectTags", Date.now() - startTime, {
        projectPath,
        tagCount: tags.length
      });
      return tags;
    } catch (error) {
      this.logger.warn(`Error fetching tags: ${error}`);
      return [];
    }
  }
  /**
   * Sort versions with semantic versions first, then branches
   * Priority order: semantic versions (newest first) > other versions > main/master branches
   * @param versions Array of version strings to sort
   * @returns Sorted array of version strings
   */
  sortVersionsByPriority(versions) {
    return versions.sort((a, b) => {
      if (a === "main" || a === "master") return 1;
      if (b === "main" || b === "master") return -1;
      const aMatch = a.match(/^v?(\d+)\.(\d+)\.(\d+)/);
      const bMatch = b.match(/^v?(\d+)\.(\d+)\.(\d+)/);
      if (aMatch && bMatch) {
        const aMajor = parseInt(aMatch[1]);
        const bMajor = parseInt(bMatch[1]);
        if (aMajor !== bMajor) return bMajor - aMajor;
        const aMinor = parseInt(aMatch[2]);
        const bMinor = parseInt(bMatch[2]);
        if (aMinor !== bMinor) return bMinor - aMinor;
        const aPatch = parseInt(aMatch[3]);
        const bPatch = parseInt(bMatch[3]);
        return bPatch - aPatch;
      }
      if (aMatch && !bMatch) return -1;
      if (!aMatch && bMatch) return 1;
      return b.localeCompare(a);
    });
  }
};

// ../../src/services/component/componentFetcher.ts
var vscode5 = __toESM(require("vscode"));

// ../../src/constants/regex.ts
var SPEC_INPUTS_SECTION_REGEX = /spec:\s*\n\s*inputs:([\s\S]*?)(?=\n---|\ndescription:|\nvariables:|\n[a-zA-Z][a-zA-Z0-9_-]*:|$)/;

// ../../src/parsers/specParser.ts
var logger = Logger.getInstance();
var errorHandler = getErrorHandler();
var GitLabSpecParser = class {
  /**
   * Parse GitLab component spec from template content
   * @param content Full template content (YAML)
   * @param fileName Optional filename for logging purposes
   * @returns Parsed spec with description, variables, and validity flag
   * @throws ParseError if content is invalid or parsing fails
   */
  static parse(content, fileName) {
    const logPrefix = fileName ? `[SpecParser] Template ${fileName}:` : "[SpecParser]";
    try {
      if (typeof content !== "string") {
        throw new ParseError("Content must be a string", {
          yaml: String(content).substring(0, 100)
        });
      }
      if (content.trim().length === 0) {
        throw new ParseError("Content is empty", { yaml: content });
      }
      let extractedDescription = "";
      let extractedVariables = [];
      const parts = content.split(/^---\s*$/m);
      const specSection = parts[0] || "";
      logger.debug(`${logPrefix} Found ${parts.length} sections (spec + jobs)`, "SpecParser");
      logger.debug(`${logPrefix} Spec section length: ${specSection.length} chars`, "SpecParser");
      const hasSpecSection = specSection.match(/^spec:\s*$/m) !== null;
      const commentMatch = specSection.match(/^#\s*(.+?)$/m);
      if (commentMatch && !commentMatch[1].toLowerCase().includes("gitlab") && !commentMatch[1].toLowerCase().includes("ci")) {
        extractedDescription = commentMatch[1].trim();
        logger.debug(`${logPrefix} Found comment description: ${extractedDescription}`, "SpecParser");
      }
      try {
        const specMatches = specSection.match(SPEC_INPUTS_SECTION_REGEX);
        if (specMatches) {
          logger.debug(`${logPrefix} Found spec inputs section`, "SpecParser");
          extractedVariables = this.parseInputsSection(specMatches[1], logPrefix);
        } else {
          logger.debug(`${logPrefix} No spec inputs found, trying fallback parsing`, "SpecParser");
          extractedVariables = this.parseLegacyVariablesSection(specSection, logPrefix);
        }
      } catch (error) {
        throw new ParseError("Failed to parse spec inputs/variables", {
          cause: error,
          yaml: specSection.substring(0, 500)
        });
      }
      const isValidComponent = hasSpecSection;
      logger.debug(`${logPrefix} isValidComponent=${isValidComponent} (hasSpecSection=${hasSpecSection})`, "SpecParser");
      return {
        description: extractedDescription,
        variables: extractedVariables,
        isValidComponent
      };
    } catch (error) {
      if (error instanceof ParseError) {
        throw error;
      }
      throw new ParseError(
        `Failed to parse GitLab component spec: ${error instanceof Error ? error.message : String(error)}`,
        {
          cause: error,
          yaml: content.substring(0, 500)
        }
      );
    }
  }
  /**
   * Parse the new spec.inputs format
   */
  static parseInputsSection(inputsSection, logPrefix) {
    const extractedVariables = [];
    const inputLines = inputsSection.split("\n").filter((line) => line.trim() && !line.trim().startsWith("#"));
    let currentInput = null;
    for (const line of inputLines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;
      if (line.match(/^[a-zA-Z][a-zA-Z0-9_-]*:/)) {
        logger.debug(`${logPrefix} Stopping at top-level key: ${trimmedLine}`, "SpecParser");
        break;
      }
      if (line.match(/^\s{2,4}[a-zA-Z_][a-zA-Z0-9_]*:\s*$/)) {
        if (currentInput) {
          if (currentInput.default === void 0) {
            currentInput.required = true;
          }
          extractedVariables.push(currentInput);
        }
        const inputName = trimmedLine.split(":")[0];
        currentInput = {
          name: inputName,
          description: `Parameter: ${inputName}`,
          required: false,
          // Will be updated to true if no default found
          type: "string",
          default: void 0
        };
        logger.debug(`${logPrefix} Found input parameter: ${inputName}`, "SpecParser");
      } else if (currentInput && line.match(/^\s{4,}/)) {
        if (trimmedLine.startsWith("description:")) {
          currentInput.description = trimmedLine.substring(12).replace(/^["']|["']$/g, "").trim();
        } else if (trimmedLine.startsWith("default:")) {
          currentInput.default = trimmedLine.substring(8).replace(/^["']|["']$/g, "").trim();
        } else if (trimmedLine.startsWith("type:")) {
          currentInput.type = trimmedLine.substring(5).replace(/^["']|["']$/g, "").trim();
        }
      }
    }
    if (currentInput) {
      if (currentInput.default === void 0) {
        currentInput.required = true;
      }
      extractedVariables.push(currentInput);
    }
    logger.debug(`${logPrefix} Extracted ${extractedVariables.length} input parameters from spec`, "SpecParser");
    return extractedVariables;
  }
  /**
   * Safe parse that returns either the result or error without throwing
   * Useful for batch operations where one failure shouldn't stop processing
   * @param content Full template content (YAML)
   * @param fileName Optional filename for logging purposes
   * @returns Object with either parsed data or error
   */
  static safeParse(content, fileName) {
    try {
      const data = this.parse(content, fileName);
      return { success: true, data };
    } catch (error) {
      const parseError = error instanceof ParseError ? error : new ParseError(
        error instanceof Error ? error.message : String(error),
        { cause: error, yaml: content.substring(0, 500) }
      );
      return { success: false, error: parseError };
    }
  }
  /**
   * Parse the legacy spec.variables format
   */
  static parseLegacyVariablesSection(specSection, logPrefix) {
    const variableMatches = specSection.match(/spec:\s*[\s\S]*?variables:([\s\S]*?)(?=\n[a-zA-Z][a-zA-Z0-9_-]*:|$)/);
    if (!variableMatches) {
      logger.debug(`${logPrefix} No variables found in fallback parsing`, "SpecParser");
      return [];
    }
    const variableSection = variableMatches[1];
    const varLines = variableSection.split("\n");
    const extractedVariables = varLines.filter((line) => {
      const trimmed = line.trim();
      return trimmed && line.match(/^\s{2,}/) && // Must be indented
        trimmed.includes(":") && !trimmed.startsWith("#") && !line.match(/^[a-zA-Z][a-zA-Z0-9_-]*:/);
    }).map((line) => {
      const parts = line.trim().split(":");
      const varName = parts[0].trim();
      const defaultValue = parts.slice(1).join(":").trim();
      return {
        name: varName,
        description: `Parameter: ${varName}`,
        required: false,
        type: "string",
        default: defaultValue || void 0
      };
    });
    logger.debug(`${logPrefix} Extracted ${extractedVariables.length} variables from fallback parsing`, "SpecParser");
    return extractedVariables;
  }
};

// ../../src/services/component/componentFetcher.ts
async function promptForTokenIfNeeded(context, tokenManager, gitlabInstance, projectPath) {
  const tokenPrompt = `This project/group requires a GitLab personal access token for ${gitlabInstance}. Please enter one to continue.`;
  const token = await vscode5.window.showInputBox({
    prompt: tokenPrompt,
    password: true,
    ignoreFocusOut: true
  });
  if (token && token.trim()) {
    await tokenManager.setTokenForProject(gitlabInstance, projectPath, token.trim());
    vscode5.window.showInformationMessage(`Token saved for ${gitlabInstance}`);
    return token.trim();
  } else if (token === "") {
    vscode5.window.showInformationMessage("No token entered. Public access will be used.");
    return void 0;
  }
  return void 0;
}
var ComponentFetcher = class {
  constructor(httpClient, tokenManager, urlParser) {
    this.logger = Logger.getInstance();
    this.catalogCache = /* @__PURE__ */ new Map();
    this.httpClient = httpClient;
    this.tokenManager = tokenManager;
    this.urlParser = urlParser;
  }
  /**
   * Fetch component metadata from a GitLab URL
   * Tries catalog API first, then falls back to repository API
   */
  async fetchComponentMetadata(url, context) {
    const startTime = Date.now();
    try {
      const urlObj = new URL(url);
      const gitlabInstance = urlObj.hostname;
      const pathParts = urlObj.pathname.split("/").filter(Boolean);
      let componentName;
      let version;
      let projectPath;
      let projectOnlyUrl = false;
      const lastPart = pathParts[pathParts.length - 1];
      if (lastPart.includes("@")) {
        [componentName, version] = lastPart.split("@");
        projectPath = pathParts.slice(0, pathParts.length - 1).join("/");
      } else if (pathParts.length >= 3) {
        componentName = lastPart;
        version = "main";
        projectPath = pathParts.slice(0, pathParts.length - 1).join("/");
      } else {
        componentName = "main";
        version = "main";
        projectPath = pathParts.join("/");
        projectOnlyUrl = true;
      }
      this.logger.debug(
        `Parsed URL: Project=${projectPath}, Component=${componentName}, Version=${version}`
      );
      const encodedProjectPath = encodeURIComponent(projectPath);
      const apiBaseUrl = `https://${gitlabInstance}/api/v4`;
      let templateContent = "";
      let parameters = [];
      try {
        const namespaceProject = projectPath;
        const catalogApiUrl = `https://${gitlabInstance}/api/v4/ci/catalog/${encodeURIComponent(
          namespaceProject
        )}`;
        const token2 = await this.tokenManager.getTokenForProject(gitlabInstance, projectPath);
        const catalogFetchOptions = token2 ? { headers: { "PRIVATE-TOKEN": token2 } } : void 0;
        this.logger.debug(`Trying to fetch from GitLab Catalog API: ${catalogApiUrl}`);
        this.logger.debug(`Using token for catalog API: ${token2 ? "YES" : "NO"}`);
        const catalogData = await this.httpClient.fetchJson(
          catalogApiUrl,
          catalogFetchOptions
        );
        if (catalogData && catalogData.components) {
          let catalogComponent = catalogData.components.find(
            (c) => c.name === componentName
          );
          if (!catalogComponent && projectOnlyUrl) {
            const projectBaseName = projectPath.split("/").pop() || "";
            catalogComponent = catalogData.components.find((c) => c.name === "main") || catalogData.components.find((c) => c.name === projectBaseName) || (catalogData.components.length === 1 ? catalogData.components[0] : void 0);
            if (catalogComponent) {
              componentName = catalogComponent.name;
              this.logger.debug(
                `Project-only URL resolved to component: ${componentName}`,
                "ComponentFetcher"
              );
            }
          }
          if (catalogComponent) {
            this.logger.info(`Found component in catalog: ${componentName}`);
            let extractedParameters = catalogComponent.variables?.map((v) => ({
              name: v.name,
              description: v.description || `Parameter: ${v.name}`,
              required: v.required || false,
              type: v.type || "string",
              default: v.default
            })) || [];
            if (extractedParameters.length === 0) {
              const templateResult2 = await this.fetchTemplate(
                apiBaseUrl,
                encodedProjectPath,
                componentName,
                version,
                catalogFetchOptions
              );
              if (templateResult2?.parameters?.length) {
                extractedParameters = templateResult2.parameters;
              }
            }
            const component2 = {
              name: componentName,
              description: `# ${componentName}

${catalogComponent.description || ""}

**From GitLab CI/CD Catalog**
**Project:** [${projectPath}](https://${gitlabInstance}/${projectPath})
**Version:** ${version}

` + (catalogComponent.documentation_url ? `[Full Documentation](${catalogComponent.documentation_url})` : ""),
              parameters: extractedParameters,
              version,
              source: `${gitlabInstance}/${projectPath}`,
              documentationUrl: catalogComponent.documentation_url
            };
            this.logger.logPerformance("fetchComponentMetadata (catalog)", Date.now() - startTime);
            return component2;
          }
        }
      } catch (catalogError) {
        this.logger.debug(`Could not fetch from catalog: ${catalogError}`);
      }
      const projectApiUrl = `${apiBaseUrl}/projects/${encodedProjectPath}`;
      this.logger.debug(`Fetching project info from: ${projectApiUrl}`);
      let token = await this.tokenManager.getTokenForProject(gitlabInstance, projectPath);
      let fetchOptions = token ? { headers: { "PRIVATE-TOKEN": token } } : void 0;
      this.logger.debug(`Using token for ${gitlabInstance}: ${token ? "YES" : "NO"}`);
      let projectInfo;
      let templateResult;
      try {
        [projectInfo, templateResult] = await Promise.allSettled([
          this.httpClient.fetchJson(projectApiUrl, fetchOptions),
          this.fetchTemplate(apiBaseUrl, encodedProjectPath, componentName, version, fetchOptions)
        ]);
      } catch (err) {
        if (err && (err.status === 401 || err.status === 403)) {
          token = await promptForTokenIfNeeded(context, this.tokenManager, gitlabInstance, projectPath);
          if (token) {
            fetchOptions = { headers: { "PRIVATE-TOKEN": token } };
            [projectInfo, templateResult] = await Promise.allSettled([
              this.httpClient.fetchJson(projectApiUrl, fetchOptions),
              this.fetchTemplate(
                apiBaseUrl,
                encodedProjectPath,
                componentName,
                version,
                fetchOptions
              )
            ]);
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      }
      if (projectInfo.status === "rejected") {
        throw new Error(`Failed to fetch project info: ${projectInfo.reason}`);
      }
      const project = projectInfo.value;
      if (templateResult.status === "fulfilled" && templateResult.value) {
        const { content, parameters: extractedParams } = templateResult.value;
        templateContent = content;
        parameters = extractedParams;
        this.logger.debug(`Found component template with ${parameters.length} parameters`);
      }
      let cleanDescription = "";
      if (project.description && project.description.trim()) {
        cleanDescription = project.description.trim();
      } else {
        cleanDescription = `Component/Project does not have a description`;
      }
      const component = {
        name: componentName,
        description: cleanDescription,
        parameters,
        version,
        source: `${gitlabInstance}/${projectPath}`
      };
      this.logger.logPerformance("fetchComponentMetadata (full)", Date.now() - startTime, {
        hasTemplate: !!templateContent,
        paramCount: parameters.length
      });
      return component;
    } catch (error) {
      this.logger.error(`Error fetching component metadata: ${error}`);
      const urlParts = url.split("/");
      const lastPart = urlParts[urlParts.length - 1];
      const componentName = lastPart.includes("@") ? lastPart.split("@")[0] : lastPart;
      return {
        name: componentName,
        description: `Component from ${url}

Could not fetch detailed information: ${error}`,
        parameters: []
      };
    }
  }
  /**
   * Helper method for parallel template fetching
   */
  async fetchTemplate(apiBaseUrl, projectId, componentName, version, fetchOptions) {
    try {
      const templatePathCandidates = [
        `templates/${componentName}.yml`,
        `templates/${componentName}.yaml`,
        `templates/${componentName}/template.yml`,
        `templates/${componentName}/template.yaml`
      ];
      let templateContent = null;
      let resolvedTemplatePath = "";
      for (const templatePath of templatePathCandidates) {
        const templateUrl = `${apiBaseUrl}/projects/${projectId}/repository/files/${encodeURIComponent(
          templatePath
        )}/raw?ref=${version}`;
        this.logger.debug(`[ComponentFetcher] Trying template path: ${templatePath}`);
        try {
          templateContent = await this.httpClient.fetchText(templateUrl, fetchOptions);
          resolvedTemplatePath = templatePath;
          break;
        } catch {
        }
      }
      if (!templateContent) {
        this.logger.debug(`[ComponentFetcher] No template found for ${componentName} at known paths`);
        return null;
      }
      this.logger.debug(
        `[ComponentFetcher] Template content received from ${resolvedTemplatePath}, length: ${templateContent.length} chars`
      );
      const parsedSpec = GitLabSpecParser.parse(templateContent, componentName);
      this.logger.debug(
        `[ComponentFetcher] Template ${componentName}: Extracted ${parsedSpec.variables.length} parameters`
      );
      parsedSpec.variables.forEach((param) => {
        this.logger.debug(
          `[ComponentFetcher] Template ${componentName}: Parameter: ${param.name} (${param.type}, required: ${param.required})`
        );
      });
      return { content: templateContent, parameters: parsedSpec.variables };
    } catch (error) {
      this.logger.debug(`Could not fetch component template: ${error}`);
      return null;
    }
  }
  /**
   * Fetch component catalog data from GitLab with optimizations
   */
  async fetchCatalogData(gitlabInstance, projectPath, forceRefresh = false, version, context) {
    const startTime = Date.now();
    const versionSuffix = version ? `@${version}` : "";
    const cacheKey = `catalog:${gitlabInstance}:${projectPath}${versionSuffix}`;
    this.logger.info(`fetchCatalogData called for ${gitlabInstance}/${projectPath}${versionSuffix}`);
    this.logger.debug(`Force refresh: ${forceRefresh}`);
    const cleanGitlabInstance = this.urlParser.cleanGitLabInstance(gitlabInstance);
    if (!forceRefresh && this.catalogCache.has(cacheKey)) {
      this.logger.info(`Returning cached catalog data for ${cacheKey}`);
      this.logger.logPerformance("fetchCatalogData (cached)", Date.now() - startTime);
      return this.catalogCache.get(cacheKey);
    }
    this.logger.info(`Fetching fresh catalog data from ${cleanGitlabInstance}`);
    try {
      const apiBaseUrl = `https://${cleanGitlabInstance}/api/v4`;
      let ref = version || "main";
      let token = await this.tokenManager.getTokenForProject(cleanGitlabInstance, projectPath);
      let fetchOptions = token ? { headers: { "PRIVATE-TOKEN": token } } : void 0;
      const [projectInfoResult, templatesResult] = await Promise.allSettled([
        this.httpClient.fetchJson(
          `${apiBaseUrl}/projects/${encodeURIComponent(projectPath)}`,
          fetchOptions
        ),
        this.httpClient.fetchJson(
          `${apiBaseUrl}/projects/${encodeURIComponent(
            projectPath
          )}/repository/tree?path=templates&ref=${ref}`,
          fetchOptions
        )
      ]);
      let projectInfo;
      let templates;
      if (projectInfoResult.status === "rejected") {
        const err = projectInfoResult.reason;
        if (err && (err.status === 401 || err.status === 403)) {
          token = await promptForTokenIfNeeded(context, this.tokenManager, cleanGitlabInstance, projectPath);
          if (token) {
            fetchOptions = { headers: { "PRIVATE-TOKEN": token } };
            const [retryProjectInfo, retryTemplates] = await Promise.allSettled([
              this.httpClient.fetchJson(
                `${apiBaseUrl}/projects/${encodeURIComponent(projectPath)}`,
                fetchOptions
              ),
              this.httpClient.fetchJson(
                `${apiBaseUrl}/projects/${encodeURIComponent(
                  projectPath
                )}/repository/tree?path=templates&ref=${ref}`,
                fetchOptions
              )
            ]);
            if (retryProjectInfo.status === "rejected") {
              throw retryProjectInfo.reason;
            }
            projectInfo = retryProjectInfo.value;
            templates = retryTemplates.status === "fulfilled" ? retryTemplates.value : [];
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      } else {
        projectInfo = projectInfoResult.value;
        templates = templatesResult.status === "fulfilled" ? templatesResult.value : [];
      }
      if (projectInfo && projectInfo.default_branch) {
        ref = projectInfo.default_branch;
      }
      this.logger.debug(`Found project: ${projectInfo.name} (ID: ${projectInfo.id}), using ref: ${ref}`);
      const yamlFiles = await this.fetchAllTemplateFiles(apiBaseUrl, projectPath, ref, fetchOptions);
      this.logger.debug(`Found ${yamlFiles.length} YAML template files`);
      if (yamlFiles.length === 0) {
        this.logger.info(`No YAML templates found in ${projectPath}`);
        const catalogData2 = { components: [] };
        this.catalogCache.set(cacheKey, catalogData2);
        return catalogData2;
      }
      const config = vscode5.workspace.getConfiguration("gitlabComponentHelper");
      const batchSize = config.get("batchSize", 5);
      const componentResults = await this.httpClient.processBatch(
        yamlFiles,
        async (file) => {
          const relativePath = file.path.replace(/^templates\//, "");
          const name = relativePath.includes("/") ? relativePath.split("/")[0] : relativePath.replace(/\.ya?ml$/, "");
          this.logger.debug(`Processing component: ${name} (${relativePath})`);
          const templateResult = await this.fetchTemplateContent(
            apiBaseUrl,
            projectInfo.id,
            relativePath,
            ref,
            fetchOptions
          );
          let description = "";
          let variables = [];
          if (templateResult) {
            const { extractedVariables, extractedDescription, isValidComponent } = templateResult;
            if (!isValidComponent) {
              this.logger.debug(
                `[ComponentFetcher] Skipping ${name}: not a valid GitLab CI/CD component (no spec section)`
              );
              return null;
            }
            variables = extractedVariables;
            description = extractedDescription || `${name} component`;
          } else {
            this.logger.debug(`[ComponentFetcher] Skipping ${name}: could not fetch template content`);
            return null;
          }
          return {
            name,
            description,
            variables,
            latest_version: ref
          };
        },
        batchSize
      );
      const components = componentResults.filter((c) => c !== null);
      this.logger.debug(
        `[ComponentFetcher] ${components.length} of ${yamlFiles.length} templates are valid components`
      );
      const catalogData = { components };
      this.catalogCache.set(cacheKey, catalogData);
      this.logger.info(`Successfully processed ${components.length} components`);
      this.logger.logPerformance("fetchCatalogData (fresh)", Date.now() - startTime, {
        componentCount: components.length,
        batchSize,
        projectPath
      });
      return catalogData;
    } catch (error) {
      this.logger.error(`Error fetching catalog data for ${projectPath}: ${error}`);
      throw error;
    }
  }
  /**
   * Fetch YAML template files from templates/ including one nested directory level.
   */
  async fetchAllTemplateFiles(apiBaseUrl, projectPath, ref, fetchOptions) {
    const treeUrl = `${apiBaseUrl}/projects/${encodeURIComponent(projectPath)}/repository/tree?path=templates&ref=${ref}`;
    const topLevel = await this.httpClient.fetchJson(treeUrl, fetchOptions).catch(() => []);
    const yamlFiles = topLevel.filter(
      (item) => item.type === "blob" && (item.name.endsWith(".yml") || item.name.endsWith(".yaml"))
    );
    const subdirs = topLevel.filter((item) => item.type === "tree");
    for (const subdir of subdirs) {
      const subdirUrl = `${apiBaseUrl}/projects/${encodeURIComponent(projectPath)}/repository/tree?path=${encodeURIComponent("templates/" + subdir.name)}&ref=${ref}`;
      const subdirContents = await this.httpClient.fetchJson(subdirUrl, fetchOptions).catch(() => []);
      const subdirYaml = subdirContents.filter(
        (item) => item.type === "blob" && (item.name.endsWith(".yml") || item.name.endsWith(".yaml"))
      );
      yamlFiles.push(...subdirYaml);
    }
    return yamlFiles;
  }
  /**
   * Helper method for parallel template content fetching
   */
  async fetchTemplateContent(apiBaseUrl, projectId, relativePath, ref, fetchOptions) {
    try {
      const contentUrl = `${apiBaseUrl}/projects/${projectId}/repository/files/${encodeURIComponent(
        "templates/" + relativePath
      )}/raw?ref=${ref}`;
      const content = await this.httpClient.fetchText(contentUrl, fetchOptions);
      const parsedSpec = GitLabSpecParser.parse(content, relativePath);
      return {
        content,
        extractedVariables: parsedSpec.variables,
        extractedDescription: parsedSpec.description,
        isValidComponent: parsedSpec.isValidComponent
      };
    } catch (error) {
      this.logger.debug(`Could not fetch template content: ${error}`);
      return null;
    }
  }
  /**
   * Fetch project information from GitLab API
   */
  async fetchProjectInfo(gitlabInstance, projectPath) {
    const apiBaseUrl = `https://${gitlabInstance}/api/v4`;
    const token = await this.tokenManager.getTokenForProject(gitlabInstance, projectPath);
    const fetchOptions = token ? { headers: { "PRIVATE-TOKEN": token } } : void 0;
    return this.httpClient.fetchJson(
      `${apiBaseUrl}/projects/${encodeURIComponent(projectPath)}`,
      fetchOptions
    );
  }
  /**
   * Clear the catalog cache
   */
  clearCache() {
    this.catalogCache.clear();
  }
  /**
   * Get catalog cache statistics
   */
  getCatalogCacheStats() {
    return {
      size: this.catalogCache.size,
      keys: Array.from(this.catalogCache.keys())
    };
  }
};

// ../../src/services/component/componentService.ts
var sourceCache = /* @__PURE__ */ new Map();
var ComponentService = class {
  constructor() {
    this.httpClient = new HttpClient();
    this.logger = Logger.getInstance();
    this.performanceMonitor = getPerformanceMonitor();
    this.componentCache = /* @__PURE__ */ new Map();
    // Legacy methods for backward compatibility
    this.legacyTokenWarningLogged = false;
    this.tokenManager = new TokenManager();
    this.urlParser = new UrlParser();
    this.versionManager = new VersionManager(this.httpClient, this.tokenManager);
    this.componentFetcher = new ComponentFetcher(
      this.httpClient,
      this.tokenManager,
      this.urlParser
    );
  }
  // Token management delegation
  setSecretStorage(secretStorage) {
    this.tokenManager.setSecretStorage(secretStorage);
  }
  async getTokenForProject(gitlabInstance, projectPath) {
    return this.tokenManager.getTokenForProject(gitlabInstance, projectPath);
  }
  async setTokenForProject(gitlabInstance, projectPath, token) {
    return this.tokenManager.setTokenForProject(gitlabInstance, projectPath, token);
  }
  async getTokenForInstance(gitlabInstance) {
    return this.tokenManager.getTokenForInstance(gitlabInstance);
  }
  // Component retrieval
  async getComponents() {
    return this.getLocalComponents();
  }
  async getComponent(name) {
    const components = await this.getComponents();
    return components.find((c) => c.name === name);
  }
  // Component fetching delegation
  async getComponentFromUrl(url, context) {
    try {
      const component = await this.componentFetcher.fetchComponentMetadata(url, context);
      if (component) {
        const parsed = this.urlParser.parseCustomComponentUrl(url);
        if (parsed) {
          component.context = {
            gitlabInstance: parsed.gitlabInstance,
            path: parsed.path
          };
        }
      }
      return component;
    } catch (error) {
      this.logger.error(`Error fetching component from URL: ${error}`);
      throw error;
    }
  }
  // URL parsing delegation
  parseCustomComponentUrl(url) {
    return this.urlParser.parseCustomComponentUrl(url);
  }
  // Version management delegation
  async fetchProjectVersions(gitlabInstance, projectPath) {
    return this.versionManager.fetchProjectVersions(gitlabInstance, projectPath);
  }
  async fetchProjectTags(gitlabInstance, projectPath) {
    return this.versionManager.fetchProjectTags(gitlabInstance, projectPath);
  }
  // Catalog data delegation
  async fetchCatalogData(gitlabInstance, projectPath, forceRefresh = false, version, context) {
    return this.componentFetcher.fetchCatalogData(
      gitlabInstance,
      projectPath,
      forceRefresh,
      version,
      context
    );
  }
  // HTTP client delegation
  async fetchJson(url, options) {
    return this.httpClient.fetchJson(url, options);
  }
  async fetchRawFile(gitlabInstance, projectPath, filePath, ref = "main") {
    const cleanGitlabInstance = this.urlParser.cleanGitLabInstance(gitlabInstance);
    const url = `https://${cleanGitlabInstance}/api/v4/projects/${encodeURIComponent(
      projectPath
    )}/repository/files/${encodeURIComponent(filePath)}/raw?ref=${ref}`;
    const token = await this.getTokenForProject(cleanGitlabInstance, projectPath);
    const headers = token ? { "PRIVATE-TOKEN": token } : void 0;
    return this.httpClient.fetchText(url, { headers });
  }
  async fetchText(url) {
    return this.httpClient.fetchText(url);
  }
  // Local mock components (for fallback/testing)
  getLocalComponents() {
    return [
      {
        name: "deploy-component",
        description: "Deploys the application to the specified environment",
        parameters: [
          {
            name: "environment",
            description: "Target environment for deployment",
            required: true,
            type: "string"
          },
          {
            name: "version",
            description: "Version to deploy",
            required: false,
            type: "string",
            default: "latest"
          }
        ]
      },
      {
        name: "test-component",
        description: "Runs tests for the application",
        parameters: [
          {
            name: "test_type",
            description: "Type of tests to run",
            required: true,
            type: "string"
          },
          {
            name: "coverage",
            description: "Whether to collect coverage information",
            required: false,
            type: "boolean",
            default: false
          }
        ]
      }
    ];
  }
  async resolveLegacyGitlabToken(gitlabHost) {
    const secretToken = await this.tokenManager.getTokenForInstance(gitlabHost);
    if (secretToken) {
      return secretToken;
    }
    const config = vscode6.workspace.getConfiguration("gitlabComponentHelper");
    const settingToken = config.get("gitlabToken", "");
    if (settingToken && !this.legacyTokenWarningLogged) {
      this.logger.warn(
        '[ComponentService] Using gitlabComponentHelper.gitlabToken from settings.json (plain text). Run the "GitLab CI: Add Component Project/Group" command to migrate this token to encrypted SecretStorage, then clear the setting.'
      );
      this.legacyTokenWarningLogged = true;
    }
    return settingToken;
  }
  async fetchFromGitLab() {
    const config = vscode6.workspace.getConfiguration("gitlabComponentHelper");
    const gitlabUrl = config.get("gitlabUrl", "");
    const projectId = config.get("gitlabProjectId", "");
    const filePath = config.get("gitlabComponentsFilePath", "components.json");
    if (!gitlabUrl || !projectId) {
      throw new Error("GitLab URL or project ID not configured");
    }
    const gitlabHost = (() => {
      try {
        return new URL(gitlabUrl).hostname;
      } catch {
        return gitlabUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
      }
    })();
    const token = await this.resolveLegacyGitlabToken(gitlabHost);
    if (!token) {
      throw new Error(
        `No GitLab token configured for ${gitlabHost}. Run the "GitLab CI: Add Component Project/Group" command to add one.`
      );
    }
    const apiUrl = `${gitlabUrl}/api/v4/projects/${encodeURIComponent(
      projectId
    )}/repository/files/${encodeURIComponent(filePath)}/raw`;
    try {
      const components = await this.httpClient.fetchJson(apiUrl, {
        headers: {
          "PRIVATE-TOKEN": token
        }
      });
      this.logger.info(`Successfully fetched ${components.length} components from GitLab`);
      return components;
    } catch (error) {
      this.logger.error(`GitLab fetch failed: ${error}`);
      throw error;
    }
  }
  async fetchFromUrl() {
    const config = vscode6.workspace.getConfiguration("gitlabComponentHelper");
    const url = config.get("componentsUrl", "");
    if (!url) {
      throw new Error("Components URL not configured");
    }
    try {
      const components = await this.httpClient.fetchJson(url);
      this.logger.info(`Successfully fetched ${components.length} components from URL`);
      return components;
    } catch (error) {
      this.logger.error(`URL fetch failed: ${error}`);
      throw error;
    }
  }
  // Cache management
  updateCache() {
    this.logger.info("[ComponentService] Updating cache - forcing refresh of all data");
    this.componentFetcher.clearCache();
    this.componentCache.clear();
    sourceCache.clear();
    this.logger.info(
      "[ComponentService] Cache update completed - all cached data will be refreshed on next request"
    );
  }
  resetCache() {
    this.logger.info("[ComponentService] Resetting cache - clearing all cached data");
    this.componentFetcher.clearCache();
    this.componentCache.clear();
    sourceCache.clear();
    this.logger.info("[ComponentService] Cache reset completed - all cached data cleared");
  }
  getCacheStats() {
    const catalogStats = this.componentFetcher.getCatalogCacheStats();
    return {
      catalogCacheSize: catalogStats.size,
      componentCacheSize: this.componentCache.size,
      sourceCacheSize: sourceCache.size,
      catalogKeys: catalogStats.keys,
      componentKeys: Array.from(this.componentCache.keys()),
      sourceKeys: Array.from(sourceCache.keys())
    };
  }
};
var serviceInstance = null;
function getComponentService() {
  if (!serviceInstance) {
    serviceInstance = new ComponentService();
  }
  return serviceInstance;
}

// ../../src/services/cache/componentCacheManager.ts
var vscode9 = __toESM(require("vscode"));

// ../../src/services/component/discoveryConfig.ts
var vscode7 = __toESM(require("vscode"));
var HARD_DEFAULTS = Object.freeze({
  templateRoots: ["templates"],
  maxDepth: 1,
  filePatterns: ["*.yml", "*.yaml"],
  templateFileNames: ["template.yml", "template.yaml"]
});
var DISCOVERY_LIMITS = Object.freeze({
  maxDepth: 3,
  templateRootsCount: 5,
  filePatternsCount: 10,
  templateFileNamesCount: 10
});

// ../../src/services/component/commands.ts
var vscode8 = __toESM(require("vscode"));

// ../../src/constants/cache.ts
var CACHE_LOCATION_GLOBAL_STATE = "VS Code Global State (persistent across sessions)";
var CACHE_LOCATION_MEMORY_ONLY = "Memory only (will be lost when VS Code closes)";
var DEFAULT_COMPONENT_TYPE_PROJECT = "project";
var SOURCE_LOCAL = "Local";
var SOURCE_COMPONENTS_PREFIX = "Components from";

// ../../src/services/cache/projectCache.ts
var ProjectCache = class {
  constructor() {
    this.logger = Logger.getInstance();
  }
  /**
   * Fetch components from a specific GitLab project
   *
   * @param gitlabInstance GitLab instance hostname
   * @param projectPath Full project path (e.g., 'group/project')
   * @param sourceName Display name for this source
   * @returns Array of cached components
   */
  async fetchComponentsFromProject(gitlabInstance, projectPath, sourceName) {
    const componentService = getComponentService();
    try {
      const catalogData = await componentService.fetchCatalogData(
        gitlabInstance,
        projectPath,
        false
      );
      if (catalogData && catalogData.components) {
        this.logger.info(
          `[ProjectCache] Found ${catalogData.components.length} components in ${sourceName}`,
          "ProjectCache"
        );
        const sourceComponents = catalogData.components.map((c) => {
          const componentUrl = `https://${gitlabInstance}/${projectPath}/${c.name}@${c.latest_version || "main"}`;
          return {
            name: c.name,
            description: c.description || `Component from ${sourceName}`,
            parameters: (c.variables || []).map((v) => ({
              name: v.name,
              description: v.description || `Parameter: ${v.name}`,
              required: v.required || false,
              type: v.type || "string",
              default: v.default
            })),
            source: sourceName,
            sourcePath: projectPath,
            gitlabInstance,
            version: c.latest_version || "main",
            url: componentUrl
          };
        });
        this.logger.debug(
          `[ProjectCache] Processed ${sourceComponents.length} components from ${sourceName}`,
          "ProjectCache"
        );
        return sourceComponents;
      } else {
        this.logger.info(`[ProjectCache] No components found in ${sourceName}`, "ProjectCache");
        return [];
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[ProjectCache] Error fetching project ${projectPath}: ${errorMessage}`,
        "ProjectCache"
      );
      throw error;
    }
  }
  /**
   * Fetch a specific version of a component from a project
   *
   * @param componentName Component name
   * @param sourcePath Project path
   * @param gitlabInstance GitLab instance hostname
   * @param version Version to fetch
   * @returns Cached component or null if not found
   */
  async fetchSpecificVersion(componentName, sourcePath, gitlabInstance, version) {
    try {
      this.logger.info(
        `[ProjectCache] Fetching specific version ${version} of ${componentName} from ${sourcePath}`,
        "ProjectCache"
      );
      const componentService = getComponentService();
      this.logger.debug(`[ProjectCache] Validating version ${version} exists...`, "ProjectCache");
      const projectTags = await componentService.fetchProjectTags(gitlabInstance, sourcePath);
      const availableVersions = ["main", "master", ...projectTags.map((tag) => tag.name)];
      if (!availableVersions.includes(version)) {
        this.logger.warn(
          `[ProjectCache] Version ${version} does not exist. Available versions: ${availableVersions.slice(0, 10).join(", ")}`,
          "ProjectCache"
        );
        return null;
      }
      const catalogData = await componentService.fetchCatalogData(
        gitlabInstance,
        sourcePath,
        true,
        version
      );
      if (!catalogData || !catalogData.components || catalogData.components.length === 0) {
        this.logger.warn(
          `[ProjectCache] No component data found for version ${version}`,
          "ProjectCache"
        );
        return null;
      }
      const catalogComponent = catalogData.components.find((c) => c.name === componentName);
      if (!catalogComponent) {
        this.logger.warn(
          `[ProjectCache] Component ${componentName} not found in version ${version}`,
          "ProjectCache"
        );
        return null;
      }
      const cachedComponent = {
        name: catalogComponent.name,
        description: catalogComponent.description || `Component from ${sourcePath}`,
        parameters: (catalogComponent.variables || []).map((v) => ({
          name: v.name,
          description: v.description || `Parameter: ${v.name}`,
          required: v.required || false,
          type: v.type || "string",
          default: v.default
        })),
        source: `${SOURCE_COMPONENTS_PREFIX} ${sourcePath}`,
        sourcePath,
        gitlabInstance,
        version,
        url: `https://${gitlabInstance}/${sourcePath}/${catalogComponent.name}@${version}`
      };
      this.logger.info(
        `[ProjectCache] Successfully fetched version ${version} of ${componentName}`,
        "ProjectCache"
      );
      return cachedComponent;
    } catch (error) {
      this.logger.error(`[ProjectCache] Error fetching specific version: ${error}`, "ProjectCache");
      return null;
    }
  }
};

// ../../src/services/cache/versionCache.ts
var VersionCache = class {
  constructor() {
    this.logger = Logger.getInstance();
    // Cache for project versions: key = `${gitlabInstance}|${sourcePath}`
    this.projectVersionsCache = /* @__PURE__ */ new Map();
  }
  /**
   * Fetch and cache all available versions for a specific component
   *
   * @param component Component to fetch versions for
   * @returns Array of sorted version strings
   */
  async fetchComponentVersions(component) {
    try {
      const cacheKey = `${component.gitlabInstance}|${component.sourcePath}`;
      let sortedVersions = this.projectVersionsCache.get(cacheKey);
      if (sortedVersions) {
        this.logger.info(
          `[VersionCache] [CACHE HIT] Reusing cached versions for project ${component.gitlabInstance}/${component.sourcePath}`,
          "VersionCache"
        );
      } else {
        const componentService = getComponentService();
        const tags = await componentService.fetchProjectTags(
          component.gitlabInstance,
          component.sourcePath
        );
        const versions = ["main", "master", ...tags.map((tag) => tag.name)];
        const uniqueVersions = Array.from(new Set(versions));
        sortedVersions = this.sortVersionsByPriority(uniqueVersions);
        this.projectVersionsCache.set(cacheKey, sortedVersions);
        this.logger.info(
          `[VersionCache] [API FETCH] Fetched ${sortedVersions.length} versions for project ${component.gitlabInstance}/${component.sourcePath}`,
          "VersionCache"
        );
      }
      this.logger.debug(
        `[VersionCache] Available versions for ${component.name}: ${sortedVersions.slice(0, 5).join(", ")}${sortedVersions.length > 5 ? "..." : ""}`,
        "VersionCache"
      );
      return sortedVersions;
    } catch (error) {
      this.logger.error(
        `[VersionCache] Error fetching versions for ${component.name}: ${error}`,
        "VersionCache"
      );
      return [component.version];
    }
  }
  /**
   * Sort versions by priority (latest semantic versions first)
   *
   * Priority order:
   * 1. main branch (priority 1000)
   * 2. master branch (priority 900)
   * 3. Semantic versions (vX.Y.Z) sorted by version number descending
   * 4. Other versions (priority 0)
   *
   * @param versions Array of version strings
   * @returns Sorted array with highest priority first
   */
  sortVersionsByPriority(versions) {
    return versions.sort((a, b) => {
      const versionPriority = (version) => {
        if (version === "main") return 1e3;
        if (version === "master") return 900;
        const semanticMatch = version.match(/^v?(\d+)\.(\d+)\.(\d+)/);
        if (semanticMatch) {
          const major = parseInt(semanticMatch[1]);
          const minor = parseInt(semanticMatch[2]);
          const patch = parseInt(semanticMatch[3]);
          return major * 1e6 + minor * 1e3 + patch;
        }
        return 0;
      };
      return versionPriority(b) - versionPriority(a);
    });
  }
  /**
   * Clear the project versions cache
   */
  clearCache() {
    this.projectVersionsCache.clear();
    this.logger.debug("[VersionCache] Cleared project versions cache", "VersionCache");
  }
  /**
   * Get cached project versions (if available)
   *
   * @param gitlabInstance GitLab instance hostname
   * @param sourcePath Project path
   * @returns Cached versions or undefined if not cached
   */
  getCachedVersions(gitlabInstance, sourcePath) {
    const cacheKey = `${gitlabInstance}|${sourcePath}`;
    return this.projectVersionsCache.get(cacheKey);
  }
  /**
   * Get serializable cache data for persistence
   *
   * @returns Array of [key, versions] tuples
   */
  serializeCache() {
    return Array.from(this.projectVersionsCache.entries());
  }
  /**
   * Restore cache from serialized data
   *
   * @param data Array of [key, versions] tuples
   */
  deserializeCache(data) {
    this.projectVersionsCache = new Map(data);
    this.logger.debug(
      `[VersionCache] Restored ${this.projectVersionsCache.size} cached version entries`,
      "VersionCache"
    );
  }
  /**
   * Get cache statistics
   *
   * @returns Cache stats object
   */
  getCacheStats() {
    return {
      count: this.projectVersionsCache.size,
      keys: Array.from(this.projectVersionsCache.keys())
    };
  }
};

// ../../src/services/cache/groupCache.ts
var GroupCache = class {
  constructor(projectCache) {
    this.logger = Logger.getInstance();
    this.projectCache = projectCache;
  }
  /**
   * Fetch components from all projects in a GitLab group
   *
   * @param gitlabInstance GitLab instance hostname
   * @param groupPath Group path (e.g., 'my-group' or 'my-group/subgroup')
   * @param sourceName Display name for this source
   * @returns Array of cached components from all projects in the group
   */
  async fetchComponentsFromGroup(gitlabInstance, groupPath, sourceName) {
    this.logger.info(
      `[GroupCache] Fetching projects from group: ${gitlabInstance}/${groupPath}`,
      "GroupCache"
    );
    try {
      const groupProjects = await this.fetchGroupProjects(gitlabInstance, groupPath);
      this.logger.info(
        `[GroupCache] Found ${groupProjects.length} projects in group ${groupPath}`,
        "GroupCache"
      );
      if (groupProjects.length === 0) {
        this.logger.info(`[GroupCache] No projects found in group ${groupPath}`, "GroupCache");
        return [];
      }
      this.logger.debug(
        `[GroupCache] Checking ${groupProjects.length} projects for components (this may take a moment)...`,
        "GroupCache"
      );
      const batchSize = 5;
      const allComponents = [];
      let projectsWithComponents = 0;
      for (let i = 0; i < groupProjects.length; i += batchSize) {
        const batch = groupProjects.slice(i, i + batchSize);
        this.logger.debug(
          `[GroupCache] Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(
            groupProjects.length / batchSize
          )} (projects ${i + 1}-${Math.min(i + batchSize, groupProjects.length)})`,
          "GroupCache"
        );
        const batchPromises = batch.map(async (project) => {
          try {
            this.logger.debug(
              `[GroupCache] Checking ${project.path_with_namespace}...`,
              "GroupCache"
            );
            const components = await this.projectCache.fetchComponentsFromProject(
              gitlabInstance,
              project.path_with_namespace,
              `${sourceName}/${project.name}`
            );
            if (components.length > 0) {
              this.logger.info(
                `[GroupCache] \u2713 Found ${components.length} components in ${project.path_with_namespace}`,
                "GroupCache"
              );
              return { project, components };
            } else {
              this.logger.debug(
                `[GroupCache] - No components in ${project.path_with_namespace}`,
                "GroupCache"
              );
              return { project, components: [] };
            }
          } catch (error) {
            this.logger.error(
              `[GroupCache] \u2717 Error checking ${project.path_with_namespace}: ${error}`,
              "GroupCache"
            );
            return { project, components: [] };
          }
        });
        const batchResults = await Promise.allSettled(batchPromises);
        for (const result of batchResults) {
          if (result.status === "fulfilled" && result.value.components.length > 0) {
            allComponents.push(...result.value.components);
            projectsWithComponents++;
          } else if (result.status === "rejected") {
            this.logger.warn(`[GroupCache] Project check failed: ${result.reason}`, "GroupCache");
          }
        }
      }
      this.logger.info(`[GroupCache] Group scan complete!`, "GroupCache");
      this.logger.info(`[GroupCache] Projects scanned: ${groupProjects.length}`, "GroupCache");
      this.logger.info(
        `[GroupCache] Projects with components: ${projectsWithComponents}`,
        "GroupCache"
      );
      this.logger.info(
        `[GroupCache] Total components found: ${allComponents.length}`,
        "GroupCache"
      );
      return allComponents;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[GroupCache] Error fetching group ${groupPath}: ${errorMessage}`,
        "GroupCache"
      );
      throw error;
    }
  }
  /**
   * Fetch all projects in a GitLab group (including subgroups)
   *
   * @param gitlabInstance GitLab instance hostname
   * @param groupPath Group path
   * @returns Array of project objects from GitLab API
   */
  async fetchGroupProjects(gitlabInstance, groupPath) {
    const componentService = getComponentService();
    try {
      const groupApiUrl = `https://${gitlabInstance}/api/v4/groups/${encodeURIComponent(
        groupPath
      )}/projects?per_page=100&include_subgroups=true`;
      this.logger.info(`[GroupCache] Fetching group projects from: ${groupApiUrl}`, "GroupCache");
      const token = await componentService.getTokenForInstance(gitlabInstance);
      const fetchOptions = token ? { headers: { "PRIVATE-TOKEN": token } } : void 0;
      this.logger.debug(
        `[GroupCache] Using token for ${gitlabInstance}: ${token ? "YES" : "NO"}`,
        "GroupCache"
      );
      const projects = await componentService.fetchJson(groupApiUrl, fetchOptions);
      this.logger.info(
        `[GroupCache] Found ${projects.length} total projects in group ${groupPath}`,
        "GroupCache"
      );
      this.logger.debug(
        `[GroupCache] Will check all ${projects.length} projects for components (no pre-filtering)`,
        "GroupCache"
      );
      return projects;
    } catch (error) {
      this.logger.error(`[GroupCache] Error fetching group projects: ${error}`, "GroupCache");
      throw error;
    }
  }
};

// ../../src/services/cache/componentCacheManager.ts
var ComponentCacheManager = class {
  constructor(context) {
    this.logger = Logger.getInstance();
    this.performanceMonitor = getPerformanceMonitor();
    this.components = [];
    this.lastRefreshTime = 0;
    this.refreshInProgress = false;
    this.sourceErrors = /* @__PURE__ */ new Map();
    this.context = null;
    this.rawTemplateCache = /* @__PURE__ */ new Map();
    this.logger.debug("[ComponentCache] Constructor called", "ComponentCache");
    this.projectCache = new ProjectCache();
    this.versionCache = new VersionCache();
    this.groupCache = new GroupCache(this.projectCache);
    this.context = context || null;
    const cacheInfo = this.getCacheInfo();
    this.logger.debug(`[ComponentCache] Cache location: ${cacheInfo.location}`, "ComponentCache");
    this.initializeCache().catch((error) => {
      this.logger.debug(
        `[ComponentCache] Error during initial cache check: ${error}`,
        "ComponentCache"
      );
    });
    vscode9.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("gitlabComponentHelper.componentSources")) {
        this.logger.debug(
          "[ComponentCache] Configuration changed, forcing refresh...",
          "ComponentCache"
        );
        this.forceRefresh().catch((error) => {
          this.logger.debug(
            `[ComponentCache] Error during config refresh: ${error}`,
            "ComponentCache"
          );
        });
      }
    });
  }
  /**
   * Get cached components, refreshing if expired
   */
  async getComponents() {
    const config = vscode9.workspace.getConfiguration("gitlabComponentHelper");
    const cacheTime = config.get("cacheTime", 3600) * 1e3;
    if (Date.now() - this.lastRefreshTime > cacheTime && !this.refreshInProgress) {
      this.logger.debug(
        "[ComponentCache] Cache expired, refreshing components...",
        "ComponentCache"
      );
      this.refreshComponents().catch((error) => {
        this.logger.debug(`[ComponentCache] Error during refresh: ${error}`, "ComponentCache");
      });
    } else if (this.components.length > 0) {
      this.refreshVersions().catch((error) => {
        this.logger.debug(
          `[ComponentCache] Error during version refresh: ${error}`,
          "ComponentCache"
        );
      });
    }
    return this.components;
  }
  /**
   * Fetch and cache raw YAML templates to optimize include parsing
   */
  async fetchAndCacheRawTemplate(gitlabInstance, projectPath, filePath, version) {
    const cacheKey = `${gitlabInstance}:${projectPath}:${filePath}@${version}`;
    const config = vscode9.workspace.getConfiguration("gitlabComponentHelper");
    const cacheTime = config.get("cacheTime", 3600) * 1e3;
    const cached = this.rawTemplateCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < cacheTime) {
      this.logger.debug(`[ComponentCache] Returning cached raw template for ${cacheKey}`, "ComponentCache");
      return cached.content;
    }
    const componentService = getComponentService();
    const content = await componentService.fetchRawFile(gitlabInstance, projectPath, filePath, version);
    this.rawTemplateCache.set(cacheKey, { content, timestamp: Date.now() });
    return content;
  }
  /**
   * Add a dynamically fetched component to the cache
   */
  addDynamicComponent(component) {
    try {
      const existingIndex = this.components.findIndex(
        (comp) => comp.name === component.name && comp.sourcePath === component.sourcePath && comp.gitlabInstance === component.gitlabInstance && comp.version === component.version
      );
      if (existingIndex >= 0) {
        this.components[existingIndex] = component;
        this.logger.debug(
          `[ComponentCache] Updated existing dynamic component: ${component.name}@${component.version}`,
          "ComponentCache"
        );
      } else {
        this.components.push(component);
        this.logger.debug(
          `[ComponentCache] Added new dynamic component: ${component.name}@${component.version} from ${component.gitlabInstance}/${component.sourcePath}`,
          "ComponentCache"
        );
      }
    } catch (error) {
      this.logger.debug(
        `[ComponentCache] Error adding dynamic component: ${error}`,
        "ComponentCache"
      );
    }
  }
  getSourceErrors() {
    return new Map(this.sourceErrors);
  }
  hasErrors() {
    return this.sourceErrors.size > 0;
  }
  /**
   * Refresh all components from configured sources
   */
  async refreshComponents() {
    return this.performanceMonitor.track(
      "refreshComponents",
      async () => {
        return this.refreshComponentsInternal();
      }
    );
  }
  async refreshComponentsInternal() {
    if (this.refreshInProgress) {
      this.logger.debug(
        "[ComponentCache] Refresh already in progress, skipping...",
        "ComponentCache"
      );
      return;
    }
    this.refreshInProgress = true;
    this.logger.debug("[ComponentCache] Starting component refresh...", "ComponentCache");
    this.versionCache.clearCache();
    try {
      const config = vscode9.workspace.getConfiguration("gitlabComponentHelper");
      const sources = config.get("componentSources", []);
      this.logger.debug(
        `[ComponentCache] Found ${sources.length} configured sources`,
        "ComponentCache"
      );
      const newComponents = [];
      this.sourceErrors.clear();
      if (sources.length === 0) {
        this.logger.debug(
          "[ComponentCache] No sources configured, using local components",
          "ComponentCache"
        );
        newComponents.push(...this.getLocalFallbackComponents());
      } else {
        const fetchPromises = sources.map(async (source) => {
          try {
            let gitlabInstance = source.gitlabInstance || "gitlab.com";
            if (gitlabInstance.startsWith("https://")) {
              gitlabInstance = gitlabInstance.replace("https://", "");
            }
            if (gitlabInstance.startsWith("http://")) {
              gitlabInstance = gitlabInstance.replace("http://", "");
            }
            const sourceType = source.type || DEFAULT_COMPONENT_TYPE_PROJECT;
            this.logger.debug(
              `[ComponentCache] Fetching from ${source.name} (${sourceType}: ${gitlabInstance}/${source.path})`,
              "ComponentCache"
            );
            if (sourceType === "group") {
              return await this.groupCache.fetchComponentsFromGroup(
                gitlabInstance,
                source.path,
                source.name
              );
            } else {
              return await this.projectCache.fetchComponentsFromProject(
                gitlabInstance,
                source.path,
                source.name
              );
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(
              `[ComponentCache] Error fetching from ${source.name}: ${errorMessage}`,
              "ComponentCache"
            );
            this.sourceErrors.set(source.name, errorMessage);
            return [];
          }
        });
        const results = await Promise.allSettled(fetchPromises);
        for (const result of results) {
          if (result.status === "fulfilled" && Array.isArray(result.value)) {
            newComponents.push(...result.value);
          } else if (result.status === "rejected") {
            this.logger.warn(`[ComponentCache] Source fetch rejected: ${result.reason}`, "ComponentCache");
          }
        }
      }
      this.components = newComponents;
      this.lastRefreshTime = Date.now();
      await this.saveCacheToDisk();
      this.logger.info(
        `[ComponentCache] Cache updated with ${this.components.length} total components`,
        "ComponentCache"
      );
      this.components.forEach((comp) => {
        this.logger.debug(`[ComponentCache]   - ${comp.name} from ${comp.source}`, "ComponentCache");
      });
      this.logger.debug(
        `[ComponentCache] Checking which components need version fetching...`,
        "ComponentCache"
      );
      const componentsNeedingVersions = this.components.filter(
        (comp) => !comp.availableVersions || comp.availableVersions.length === 0
      );
      if (componentsNeedingVersions.length > 0) {
        this.logger.info(
          `[ComponentCache] Fetching versions for ${componentsNeedingVersions.length} components...`,
          "ComponentCache"
        );
        for (const component of componentsNeedingVersions) {
          try {
            await this.fetchComponentVersions(component);
          } catch (error) {
            this.logger.error(
              `[ComponentCache] Error fetching versions for ${component.name}: ${error}`,
              "ComponentCache"
            );
          }
        }
      } else {
        this.logger.info(
          `[ComponentCache] All components already have cached versions`,
          "ComponentCache"
        );
      }
      await this.saveCacheToDisk();
    } catch (error) {
      this.logger.error(`[ComponentCache] Error during refresh: ${error}`, "ComponentCache");
    } finally {
      this.refreshInProgress = false;
    }
  }
  async forceRefresh() {
    this.lastRefreshTime = 0;
    await this.refreshComponents();
  }
  addComponentToCache(component) {
    this.logger.debug(
      `[ComponentCache] Adding component to cache: ${component.name}@${component.version}`,
      "ComponentCache"
    );
    const existingIndex = this.components.findIndex(
      (c) => c.name === component.name && c.gitlabInstance === component.gitlabInstance && c.sourcePath === component.sourcePath && c.version === component.version
    );
    if (existingIndex >= 0) {
      this.logger.debug(
        `[ComponentCache] Updating existing component: ${component.name}@${component.version}`,
        "ComponentCache"
      );
      this.components[existingIndex] = component;
    } else {
      this.logger.debug(
        `[ComponentCache] Adding new component: ${component.name}@${component.version}`,
        "ComponentCache"
      );
      this.components.push(component);
    }
  }
  /**
   * Fetch and cache all available versions for a specific component
   */
  async fetchComponentVersions(component) {
    try {
      const sortedVersions = await this.versionCache.fetchComponentVersions(component);
      const cachedComponent = this.components.find(
        (c) => c.name === component.name && c.sourcePath === component.sourcePath && c.gitlabInstance === component.gitlabInstance
      );
      if (cachedComponent) {
        cachedComponent.availableVersions = sortedVersions;
        await this.saveCacheToDisk();
      }
      return sortedVersions;
    } catch (error) {
      this.logger.error(
        `[ComponentCache] Error fetching versions for ${component.name}: ${error}`,
        "ComponentCache"
      );
      return [component.version];
    }
  }
  /**
   * Fetch a specific version of a component and add it to cache
   */
  async fetchSpecificVersion(componentName, sourcePath, gitlabInstance, version) {
    const existingComponent = this.components.find(
      (c) => c.name === componentName && c.sourcePath === sourcePath && c.gitlabInstance === gitlabInstance && c.version === version
    );
    if (existingComponent) {
      this.logger.info(`[ComponentCache] Version ${version} already cached`, "ComponentCache");
      return existingComponent;
    }
    const cachedComponent = await this.projectCache.fetchSpecificVersion(
      componentName,
      sourcePath,
      gitlabInstance,
      version
    );
    if (cachedComponent) {
      this.components.push(cachedComponent);
    }
    return cachedComponent;
  }
  /**
   * Initialize cache only if needed (smart startup)
   */
  async initializeCache() {
    await this.loadCacheFromDisk();
    const config = vscode9.workspace.getConfiguration("gitlabComponentHelper");
    const cacheTime = config.get("cacheTime", 3600) * 1e3;
    if (this.components.length > 0 && Date.now() - this.lastRefreshTime < cacheTime) {
      const cacheInfo = this.getCacheInfo();
      this.logger.info(
        `[ComponentCache] Cache is still valid (${this.components.length} components, ${Math.round(
          (Date.now() - this.lastRefreshTime) / 1e3
        )}s old), skipping refresh`,
        "ComponentCache"
      );
      this.logger.debug(`[ComponentCache] Cache location: ${cacheInfo.location}`, "ComponentCache");
      return;
    }
    this.logger.info(
      "[ComponentCache] Cache is empty or expired, performing initial refresh...",
      "ComponentCache"
    );
    await this.refreshComponents();
  }
  /**
   * Check if version cache needs refreshing (less frequent than component cache)
   */
  shouldRefreshVersions() {
    const config = vscode9.workspace.getConfiguration("gitlabComponentHelper");
    const versionRefreshInterval = config.get("cacheTime", 3600) * 4 * 1e3;
    return Date.now() - this.lastRefreshTime > versionRefreshInterval;
  }
  /**
   * Refresh versions for all components (can be called separately from component refresh)
   */
  async refreshVersions() {
    if (!this.shouldRefreshVersions()) {
      this.logger.info(
        "[ComponentCache] Version cache is still fresh, skipping version refresh",
        "ComponentCache"
      );
      return;
    }
    this.logger.info(
      "[ComponentCache] Refreshing versions for all components...",
      "ComponentCache"
    );
    for (const component of this.components) {
      try {
        component.availableVersions = void 0;
        await this.fetchComponentVersions(component);
      } catch (error) {
        this.logger.error(
          `[ComponentCache] Error refreshing versions for ${component.name}: ${error}`,
          "ComponentCache"
        );
      }
    }
  }
  /**
   * Load cache from extension global state
   */
  async loadCacheFromDisk() {
    try {
      if (!this.context) {
        this.logger.warn(
          "[ComponentCache] No extension context available, starting with empty cache",
          "ComponentCache"
        );
        return;
      }
      const cacheData = this.context.globalState.get("componentCache");
      if (cacheData && cacheData.components && Array.isArray(cacheData.components)) {
        this.components = cacheData.components;
        this.lastRefreshTime = cacheData.lastRefreshTime || 0;
        if (cacheData.projectVersionsCache) {
          this.versionCache.deserializeCache(cacheData.projectVersionsCache);
        }
        this.logger.info(
          `[ComponentCache] Loaded ${this.components.length} components from global state`,
          "ComponentCache"
        );
        this.logger.debug(
          `[ComponentCache] Cache last updated: ${new Date(this.lastRefreshTime).toISOString()}`,
          "ComponentCache"
        );
        this.logger.debug(
          `[ComponentCache] Cache storage: VS Code Global State (persists across sessions)`,
          "ComponentCache"
        );
      } else {
        this.logger.info(
          "[ComponentCache] No cached data found in global state, will create new cache",
          "ComponentCache"
        );
        this.logger.debug(
          "[ComponentCache] Cache storage: VS Code Global State (persists across sessions)",
          "ComponentCache"
        );
      }
    } catch (error) {
      this.logger.error(
        `[ComponentCache] Error loading cache from global state: ${error}`,
        "ComponentCache"
      );
      this.components = [];
      this.lastRefreshTime = 0;
      this.versionCache.clearCache();
    }
  }
  /**
   * Save cache to extension global state
   */
  async saveCacheToDisk() {
    try {
      if (!this.context) {
        this.logger.warn(
          "[ComponentCache] No extension context available, cannot save cache",
          "ComponentCache"
        );
        return;
      }
      const cacheData = {
        components: this.components,
        lastRefreshTime: this.lastRefreshTime,
        projectVersionsCache: this.versionCache.serializeCache(),
        version: "1.0.0"
        // For future cache format migrations
      };
      await this.context.globalState.update("componentCache", cacheData);
      this.logger.info(
        `[ComponentCache] Saved cache to global state (${this.components.length} components)`,
        "ComponentCache"
      );
      this.logger.debug(
        `[ComponentCache] Cache storage: VS Code Global State (persists across sessions)`,
        "ComponentCache"
      );
    } catch (error) {
      this.logger.error(
        `[ComponentCache] Error saving cache to global state: ${error}`,
        "ComponentCache"
      );
    }
  }
  /**
   * Set the extension context (for cases where cache manager is created before context is available)
   */
  setContext(context) {
    if (!this.context) {
      this.context = context;
      this.logger.info(
        "[ComponentCache] Extension context set, cache persistence now enabled",
        "ComponentCache"
      );
      this.logger.debug(
        "[ComponentCache] Cache storage: VS Code Global State (persists across sessions)",
        "ComponentCache"
      );
    }
  }
  /**
   * Get cache location information for debugging
   */
  getCacheInfo() {
    const lastUpdateDate = this.lastRefreshTime > 0 ? new Date(this.lastRefreshTime).toISOString() : "Never";
    return {
      location: this.context ? CACHE_LOCATION_GLOBAL_STATE : CACHE_LOCATION_MEMORY_ONLY,
      size: this.components.length,
      lastUpdate: lastUpdateDate,
      hasContext: !!this.context
    };
  }
  /**
   * Update cache - Forces refresh of all cached data
   */
  async updateCache() {
    this.logger.info("[ComponentCache] Updating cache - forcing refresh of all data");
    await this.forceRefresh();
    const componentService = getComponentService();
    componentService.updateCache();
    this.logger.info("[ComponentCache] Cache update completed successfully");
  }
  /**
   * Reset cache - Completely clears all cached data
   */
  async resetCache() {
    this.logger.info("[ComponentCache] Resetting cache - clearing all cached data");
    this.components = [];
    this.versionCache.clearCache();
    this.sourceErrors.clear();
    this.lastRefreshTime = 0;
    if (this.context) {
      try {
        await this.context.globalState.update("gitlabComponentHelper.cachedComponents", void 0);
        await this.context.globalState.update("gitlabComponentHelper.cacheTimestamp", void 0);
        this.logger.debug("[ComponentCache] Cleared persistent cache storage", "ComponentCache");
      } catch (error) {
        this.logger.warn(
          `[ComponentCache] Failed to clear persistent storage: ${error}`,
          "ComponentCache"
        );
      }
    }
    const componentService = getComponentService();
    componentService.resetCache();
    this.logger.info("[ComponentCache] Cache reset completed successfully");
  }
  /**
   * Get detailed cache statistics
   */
  getCacheStats() {
    const componentService = getComponentService();
    const serviceStats = componentService.getCacheStats();
    const versionCacheStats = this.versionCache.getCacheStats();
    return {
      componentsCount: this.components.length,
      projectVersionsCacheCount: versionCacheStats.count,
      sourceErrorsCount: this.sourceErrors.size,
      lastRefreshTime: this.lastRefreshTime,
      memoryUsage: {
        components: this.components.map((c) => `${c.name} (${c.source})`),
        projectVersions: versionCacheStats.keys,
        sourceErrors: Array.from(this.sourceErrors.keys())
      },
      componentService: {
        catalogCacheSize: serviceStats.catalogCacheSize,
        componentCacheSize: serviceStats.componentCacheSize,
        sourceCacheSize: serviceStats.sourceCacheSize
      }
    };
  }
  /**
   * Get local fallback components when no sources are configured
   */
  getLocalFallbackComponents() {
    return [
      {
        name: "deploy-component",
        description: "Deploys the application to the specified environment",
        parameters: [
          {
            name: "environment",
            description: "Target environment for deployment",
            required: true,
            type: "string"
          },
          {
            name: "version",
            description: "Version to deploy",
            required: false,
            type: "string",
            default: "latest"
          }
        ],
        source: SOURCE_LOCAL,
        sourcePath: "local",
        gitlabInstance: "local",
        version: "latest",
        url: "deploy-component"
      },
      {
        name: "test-component",
        description: "Runs tests for the application",
        parameters: [
          {
            name: "test_type",
            description: "Type of tests to run",
            required: true,
            type: "string"
          },
          {
            name: "coverage",
            description: "Whether to collect coverage information",
            required: false,
            type: "boolean",
            default: false
          }
        ],
        source: SOURCE_LOCAL,
        sourcePath: "local",
        gitlabInstance: "local",
        version: "latest",
        url: "test-component"
      }
    ];
  }
};
var cacheManager = null;
function getComponentCacheManager(context) {
  if (!cacheManager) {
    cacheManager = new ComponentCacheManager(context);
  } else if (context && !cacheManager["context"]) {
    cacheManager.setContext(context);
  }
  return cacheManager;
}

// ../../src/parsers/pipelineParser.ts
var vscode10 = __toESM(require("vscode"));
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));

// ../../src/utils/gitlabVariables.ts
function expandGitLabVariables(text, context) {
  let expanded = text;
  if (context) {
    if (context.customVariables) {
      for (const [key, value] of Object.entries(context.customVariables)) {
        expanded = expanded.replace(new RegExp(`\\$${key}\\b`, "g"), String(value));
        expanded = expanded.replace(new RegExp(`\\$\\{${key}\\}`, "g"), String(value));
      }
    }
    if (context.gitlabInstance) {
      expanded = expanded.replace(/\$CI_SERVER_FQDN/g, context.gitlabInstance);
      expanded = expanded.replace(/\$CI_SERVER_HOST/g, context.gitlabInstance);
      expanded = expanded.replace(/\$CI_SERVER_URL/g, context.serverUrl || `https://${context.gitlabInstance}`);
    }
    if (context.projectPath) {
      expanded = expanded.replace(/\$CI_PROJECT_PATH/g, context.projectPath);
      const parts = context.projectPath.split("/");
      if (parts.length >= 2) {
        const namespace = parts.slice(0, -1).join("/");
        const projectName = parts[parts.length - 1];
        expanded = expanded.replace(/\$CI_PROJECT_NAMESPACE/g, namespace);
        expanded = expanded.replace(/\$CI_PROJECT_NAME/g, projectName);
        expanded = expanded.replace(/\$CI_PROJECT_ROOT_NAMESPACE/g, parts[0]);
      }
    }
  }
  return expanded;
}
function expandComponentUrl(componentUrl, context) {
  let expanded = componentUrl;
  if (context) {
    if (context.customVariables) {
      for (const [key, value] of Object.entries(context.customVariables)) {
        expanded = expanded.replace(new RegExp(`\\$${key}\\b`, "g"), String(value));
        expanded = expanded.replace(new RegExp(`\\$\\{${key}\\}`, "g"), String(value));
      }
    }
    if (context.gitlabInstance) {
      if (expanded.startsWith("$CI_SERVER_FQDN/")) {
        expanded = expanded.replace(/^\$CI_SERVER_FQDN\//, `https://${context.gitlabInstance}/`);
      } else {
        expanded = expanded.replace(/\$CI_SERVER_FQDN/g, context.gitlabInstance);
        expanded = expanded.replace(/\$CI_SERVER_HOST/g, context.gitlabInstance);
        expanded = expanded.replace(/\$CI_SERVER_URL/g, context.serverUrl || `https://${context.gitlabInstance}`);
      }
    }
    if (context.projectPath) {
      expanded = expanded.replace(/\$CI_PROJECT_PATH/g, context.projectPath);
      const parts = context.projectPath.split("/");
      if (parts.length >= 2) {
        const namespace = parts.slice(0, -1).join("/");
        const projectName = parts[parts.length - 1];
        expanded = expanded.replace(/\$CI_PROJECT_NAMESPACE/g, namespace);
        expanded = expanded.replace(/\$CI_PROJECT_NAME/g, projectName);
        expanded = expanded.replace(/\$CI_PROJECT_ROOT_NAMESPACE/g, parts[0]);
      }
    }
    if (expanded.includes("$CI_COMMIT_SHA")) {
      const shaValue = context.commitSha || "[current-branch-or-sha]";
      expanded = expanded.replace(/\$CI_COMMIT_SHA/g, shaValue);
    }
  }
  if (!expanded.match(/^https?:\/\//)) {
    if (expanded.match(/^[a-zA-Z0-9.-]+\//)) {
      expanded = `https://${expanded}`;
    }
  }
  return expanded;
}

// ../../src/parsers/pipelineParser.ts
var DEFAULT_STAGES = [".pre", "build", "test", "deploy", ".post"];
var RESERVED_KEYWORDS = /* @__PURE__ */ new Set([
  "image",
  "services",
  "stages",
  "types",
  "before_script",
  "after_script",
  "variables",
  "cache",
  "include",
  "pages",
  "workflow",
  "default",
  "spec"
]);
var PipelineParser = class {
  constructor(maxDepth = 10) {
    this.visitedSources = /* @__PURE__ */ new Set();
    this.allJobs = [];
    this.customStages = [];
    this.includedSources = [];
    this.errors = [];
    this.maxDepth = maxDepth;
  }
  async parse(content, sourceName, context) {
    this.visitedSources.clear();
    this.allJobs = [];
    this.customStages = [];
    this.includedSources = [sourceName];
    this.errors = [];
    await this.parseRecursive(content, sourceName, 0, context);
    return this.buildGraph();
  }
  async parseRecursive(content, sourceName, depth, context) {
    if (depth >= this.maxDepth) {
      this.errors.push(`Max recursion depth (${this.maxDepth}) reached at ${sourceName}`);
      return;
    }
    if (this.visitedSources.has(sourceName)) {
      return;
    }
    this.visitedSources.add(sourceName);
    const parts = content.split(/^---\s*$/m);
    let ciContent = content;
    if (parts.length > 1) {
      ciContent = parts.slice(1).join("\n");
    }
    const parsed = parseYaml(ciContent);
    if (!parsed || typeof parsed !== "object") {
      this.errors.push(`Failed to parse YAML for ${sourceName}`);
      return;
    }
    if (parsed.stages && Array.isArray(parsed.stages)) {
      for (const stage of parsed.stages) {
        if (!this.customStages.includes(stage)) {
          this.customStages.push(stage);
        }
      }
    }
    for (const key of Object.keys(parsed)) {
      if (RESERVED_KEYWORDS.has(key) || key.startsWith(".")) {
        continue;
      }
      const jobObj = parsed[key];
      if (jobObj && typeof jobObj === "object") {
        const stage = jobObj.stage || "test";
        this.allJobs.push({
          name: key,
          stage,
          source: sourceName
        });
      }
    }
    if (parsed.include) {
      const includes = Array.isArray(parsed.include) ? parsed.include : [parsed.include];
      for (const inc of includes) {
        await this.resolveInclude(inc, sourceName, depth + 1, context);
      }
    }
  }
  async resolveInclude(inc, currentSource, depth, context) {
    if (!inc) return;
    let targetUrl = "";
    let targetName = "";
    try {
      if (typeof inc === "string") {
        if (inc.startsWith("http")) {
          targetUrl = inc;
          targetName = inc;
        } else {
          await this.resolveLocalInclude(inc, currentSource, depth, context);
          return;
        }
      } else if (inc.local) {
        await this.resolveLocalInclude(inc.local, currentSource, depth, context);
        return;
      } else if (inc.component) {
        let componentUrl = inc.component;
        componentUrl = expandComponentUrl(componentUrl, {
          gitlabInstance: context?.gitlabInstance || "gitlab.com",
          serverUrl: context?.serverUrl,
          projectPath: context?.projectPath,
          customVariables: context?.customVariables
        });
        componentUrl = componentUrl.replace(/^https?:\/\//, "");
        targetName = `component:${componentUrl}`;
        const componentService = getComponentService();
        const parsedUrl = componentService.parseCustomComponentUrl(`https://${componentUrl}`);
        if (!parsedUrl) {
          this.errors.push(`Could not parse component URL ${componentUrl}`);
          return;
        }
        let version = parsedUrl.version || "main";
        if (version === "[current-branch-or-sha]") {
          version = "HEAD";
          this.errors.push(`Replaced missing variable $CI_COMMIT_SHA with HEAD for component ${inc.component}. <a href="command:workbench.action.openSettings?%22gitlabComponentHelper.customVariables%22">Click here to set custom variables</a>`);
        }
        const combinations = [
          `templates/${parsedUrl.name}/template.yml`,
          `templates/${parsedUrl.name}.yml`,
          `templates/template.yml`
        ];
        let fetched = false;
        const cacheManager2 = getComponentCacheManager();
        for (const templatePath of combinations) {
          try {
            const content = await cacheManager2.fetchAndCacheRawTemplate(parsedUrl.gitlabInstance, parsedUrl.path, templatePath, version);
            if (content && typeof content === "string" && !content.includes('{"message":"404 Project Not Found"}')) {
              this.includedSources.push(targetName);
              await this.parseRecursive(content, targetName, depth, context);
              fetched = true;
              break;
            }
          } catch (e) {
          }
        }
        if (!fetched) {
          this.errors.push(`Could not fetch component ${componentUrl}`);
        }
        return;
      } else if (inc.project && inc.file) {
        let projectPath = inc.project;
        projectPath = expandGitLabVariables(projectPath, {
          gitlabInstance: context?.gitlabInstance || "gitlab.com",
          projectPath: context?.projectPath,
          customVariables: context?.customVariables
        });
        const files = Array.isArray(inc.file) ? inc.file : [inc.file];
        const gitlabInstance = context?.gitlabInstance || "gitlab.com";
        const componentService = getComponentService();
        for (const file of files) {
          let expandedFile = expandGitLabVariables(typeof file === "string" ? file : String(file), {
            gitlabInstance: context?.gitlabInstance || "gitlab.com",
            projectPath: context?.projectPath,
            customVariables: context?.customVariables
          });
          targetName = `project:${projectPath}:${expandedFile}`;
          const ref = inc.ref || "HEAD";
          const cleanFile = expandedFile.replace(/^\//, "");
          try {
            const cacheManager2 = getComponentCacheManager();
            const content = await cacheManager2.fetchAndCacheRawTemplate(gitlabInstance, projectPath, cleanFile, ref);
            if (content && typeof content === "string" && !content.includes('{"message":"404 Project Not Found"}')) {
              if (!this.includedSources.includes(targetName)) {
                this.includedSources.push(targetName);
              }
              await this.parseRecursive(content, targetName, depth, context);
            } else {
              this.errors.push(`Could not fetch project file ${inc.project}/${file}`);
            }
          } catch (e) {
            this.errors.push(`Failed to fetch project file ${inc.project}/${file}: ${e}`);
          }
        }
        return;
      } else if (inc.remote) {
        let remoteUrl = inc.remote;
        remoteUrl = expandGitLabVariables(remoteUrl, {
          gitlabInstance: context?.gitlabInstance || "gitlab.com",
          serverUrl: context?.serverUrl,
          projectPath: context?.projectPath,
          customVariables: context?.customVariables
        });
        targetUrl = remoteUrl;
        targetName = `remote:${remoteUrl}`;
      } else {
        return;
      }
      if (targetUrl) {
        if (!this.includedSources.includes(targetName)) {
          this.includedSources.push(targetName);
        }
        const service = getComponentService();
        const content = await service.httpClient.fetchText(targetUrl);
        if (content) {
          await this.parseRecursive(content, targetName, depth, context);
        }
      }
    } catch (e) {
      this.errors.push(`Failed to resolve include ${targetName}: ${e}`);
    }
  }
  async resolveLocalInclude(inc, currentSource, depth, context) {
    try {
      if (path.isAbsolute(currentSource)) {
        const dir = path.dirname(currentSource);
        const localPath = inc.startsWith("/") ? path.join(dir, inc.substring(1)) : path.resolve(dir, inc);
        const workspaceFolders = vscode10.workspace.workspaceFolders;
        if (workspaceFolders) {
          const isInsideWorkspace = workspaceFolders.some((f) => {
            const relative2 = path.relative(f.uri.fsPath, localPath);
            return !relative2.startsWith("..") && !path.isAbsolute(relative2);
          });
          if (!isInsideWorkspace) {
            this.errors.push(`Access denied: local include ${inc} resolves outside the workspace boundaries.`);
            return;
          }
        }
        const localContent = await fs.promises.readFile(localPath, "utf8");
        const targetName = `local:${inc}`;
        this.includedSources.push(targetName);
        await this.parseRecursive(localContent, localPath, depth, context);
      } else {
        this.errors.push(`Cannot resolve local file ${inc} because current source is not a local file.`);
      }
    } catch (err) {
      this.errors.push(`Failed to read local file ${inc}`);
    }
  }
  buildGraph() {
    const finalStages = [];
    let orderedStages = [...this.customStages];
    if (orderedStages.length === 0) {
      orderedStages = [...DEFAULT_STAGES];
    } else {
      if (!orderedStages.includes(".pre")) orderedStages.unshift(".pre");
      if (!orderedStages.includes(".post")) orderedStages.push(".post");
    }
    const jobStages = new Set(this.allJobs.map((j) => j.stage));
    for (const s of jobStages) {
      if (!orderedStages.includes(s)) {
        orderedStages.push(s);
      }
    }
    for (const stageName of orderedStages) {
      const jobsInStage = this.allJobs.filter((j) => j.stage === stageName);
      finalStages.push({
        name: stageName,
        jobs: jobsInStage,
        isImplicit: DEFAULT_STAGES.includes(stageName) && !this.customStages.includes(stageName)
      });
    }
    return {
      stages: finalStages,
      includedSources: this.includedSources,
      errors: this.errors
    };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  PipelineParser
});
/*! Bundled license information:

js-yaml/dist/js-yaml.mjs:
  (*! js-yaml 4.1.1 https://github.com/nodeca/js-yaml @license MIT *)
*/
