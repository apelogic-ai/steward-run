"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
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

// node_modules/events-universal/default.js
var require_default = __commonJS({
  "node_modules/events-universal/default.js"(exports2, module2) {
    module2.exports = require("events");
  }
});

// node_modules/fast-fifo/fixed-size.js
var require_fixed_size = __commonJS({
  "node_modules/fast-fifo/fixed-size.js"(exports2, module2) {
    module2.exports = class FixedFIFO {
      constructor(hwm) {
        if (!(hwm > 0) || (hwm - 1 & hwm) !== 0) throw new Error("Max size for a FixedFIFO should be a power of two");
        this.buffer = new Array(hwm);
        this.mask = hwm - 1;
        this.top = 0;
        this.btm = 0;
        this.next = null;
      }
      clear() {
        this.top = this.btm = 0;
        this.next = null;
        this.buffer.fill(void 0);
      }
      push(data) {
        if (this.buffer[this.top] !== void 0) return false;
        this.buffer[this.top] = data;
        this.top = this.top + 1 & this.mask;
        return true;
      }
      shift() {
        const last = this.buffer[this.btm];
        if (last === void 0) return void 0;
        this.buffer[this.btm] = void 0;
        this.btm = this.btm + 1 & this.mask;
        return last;
      }
      peek() {
        return this.buffer[this.btm];
      }
      isEmpty() {
        return this.buffer[this.btm] === void 0;
      }
    };
  }
});

// node_modules/fast-fifo/index.js
var require_fast_fifo = __commonJS({
  "node_modules/fast-fifo/index.js"(exports2, module2) {
    var FixedFIFO = require_fixed_size();
    module2.exports = class FastFIFO {
      constructor(hwm) {
        this.hwm = hwm || 16;
        this.head = new FixedFIFO(this.hwm);
        this.tail = this.head;
        this.length = 0;
      }
      clear() {
        this.head = this.tail;
        this.head.clear();
        this.length = 0;
      }
      push(val) {
        this.length++;
        if (!this.head.push(val)) {
          const prev = this.head;
          this.head = prev.next = new FixedFIFO(2 * this.head.buffer.length);
          this.head.push(val);
        }
      }
      shift() {
        if (this.length !== 0) this.length--;
        const val = this.tail.shift();
        if (val === void 0 && this.tail.next) {
          const next = this.tail.next;
          this.tail.next = null;
          this.tail = next;
          return this.tail.shift();
        }
        return val;
      }
      peek() {
        const val = this.tail.peek();
        if (val === void 0 && this.tail.next) return this.tail.next.peek();
        return val;
      }
      isEmpty() {
        return this.length === 0;
      }
    };
  }
});

// node_modules/b4a/index.js
var require_b4a = __commonJS({
  "node_modules/b4a/index.js"(exports2, module2) {
    function isBuffer(value) {
      return Buffer.isBuffer(value) || value instanceof Uint8Array;
    }
    function isEncoding(encoding) {
      return Buffer.isEncoding(encoding);
    }
    function alloc(size, fill2, encoding) {
      return Buffer.alloc(size, fill2, encoding);
    }
    function allocUnsafe(size) {
      return Buffer.allocUnsafe(size);
    }
    function allocUnsafeSlow(size) {
      return Buffer.allocUnsafeSlow(size);
    }
    function byteLength(string, encoding) {
      return Buffer.byteLength(string, encoding);
    }
    function compare(a, b) {
      return Buffer.compare(a, b);
    }
    function concat(buffers, totalLength) {
      return Buffer.concat(buffers, totalLength);
    }
    function copy(source, target, targetStart, start, end) {
      return toBuffer(source).copy(target, targetStart, start, end);
    }
    function equals(a, b) {
      return toBuffer(a).equals(b);
    }
    function fill(buffer, value, offset, end, encoding) {
      return toBuffer(buffer).fill(value, offset, end, encoding);
    }
    function from(value, encodingOrOffset, length) {
      return Buffer.from(value, encodingOrOffset, length);
    }
    function includes(buffer, value, byteOffset, encoding) {
      return toBuffer(buffer).includes(value, byteOffset, encoding);
    }
    function indexOf(buffer, value, byfeOffset, encoding) {
      return toBuffer(buffer).indexOf(value, byfeOffset, encoding);
    }
    function lastIndexOf(buffer, value, byteOffset, encoding) {
      return toBuffer(buffer).lastIndexOf(value, byteOffset, encoding);
    }
    function swap16(buffer) {
      return toBuffer(buffer).swap16();
    }
    function swap32(buffer) {
      return toBuffer(buffer).swap32();
    }
    function swap64(buffer) {
      return toBuffer(buffer).swap64();
    }
    function toBuffer(buffer) {
      if (Buffer.isBuffer(buffer)) return buffer;
      return Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    }
    function toString(buffer, encoding, start, end) {
      return toBuffer(buffer).toString(encoding, start, end);
    }
    function write(buffer, string, offset, length, encoding) {
      return toBuffer(buffer).write(string, offset, length, encoding);
    }
    function readDoubleBE(buffer, offset) {
      return toBuffer(buffer).readDoubleBE(offset);
    }
    function readDoubleLE(buffer, offset) {
      return toBuffer(buffer).readDoubleLE(offset);
    }
    function readFloatBE(buffer, offset) {
      return toBuffer(buffer).readFloatBE(offset);
    }
    function readFloatLE(buffer, offset) {
      return toBuffer(buffer).readFloatLE(offset);
    }
    function readInt32BE(buffer, offset) {
      return toBuffer(buffer).readInt32BE(offset);
    }
    function readInt32LE(buffer, offset) {
      return toBuffer(buffer).readInt32LE(offset);
    }
    function readUInt32BE(buffer, offset) {
      return toBuffer(buffer).readUInt32BE(offset);
    }
    function readUInt32LE(buffer, offset) {
      return toBuffer(buffer).readUInt32LE(offset);
    }
    function writeDoubleBE(buffer, value, offset) {
      return toBuffer(buffer).writeDoubleBE(value, offset);
    }
    function writeDoubleLE(buffer, value, offset) {
      return toBuffer(buffer).writeDoubleLE(value, offset);
    }
    function writeFloatBE(buffer, value, offset) {
      return toBuffer(buffer).writeFloatBE(value, offset);
    }
    function writeFloatLE(buffer, value, offset) {
      return toBuffer(buffer).writeFloatLE(value, offset);
    }
    function writeInt32BE(buffer, value, offset) {
      return toBuffer(buffer).writeInt32BE(value, offset);
    }
    function writeInt32LE(buffer, value, offset) {
      return toBuffer(buffer).writeInt32LE(value, offset);
    }
    function writeUInt32BE(buffer, value, offset) {
      return toBuffer(buffer).writeUInt32BE(value, offset);
    }
    function writeUInt32LE(buffer, value, offset) {
      return toBuffer(buffer).writeUInt32LE(value, offset);
    }
    module2.exports = {
      isBuffer,
      isEncoding,
      alloc,
      allocUnsafe,
      allocUnsafeSlow,
      byteLength,
      compare,
      concat,
      copy,
      equals,
      fill,
      from,
      includes,
      indexOf,
      lastIndexOf,
      swap16,
      swap32,
      swap64,
      toBuffer,
      toString,
      write,
      readDoubleBE,
      readDoubleLE,
      readFloatBE,
      readFloatLE,
      readInt32BE,
      readInt32LE,
      readUInt32BE,
      readUInt32LE,
      writeDoubleBE,
      writeDoubleLE,
      writeFloatBE,
      writeFloatLE,
      writeInt32BE,
      writeInt32LE,
      writeUInt32BE,
      writeUInt32LE
    };
  }
});

// node_modules/text-decoder/lib/pass-through-decoder.js
var require_pass_through_decoder = __commonJS({
  "node_modules/text-decoder/lib/pass-through-decoder.js"(exports2, module2) {
    var b4a = require_b4a();
    module2.exports = class PassThroughDecoder {
      constructor(encoding) {
        this.encoding = encoding;
      }
      get remaining() {
        return 0;
      }
      decode(data) {
        return b4a.toString(data, this.encoding);
      }
      flush() {
        return "";
      }
    };
  }
});

// node_modules/text-decoder/lib/utf8-decoder.js
var require_utf8_decoder = __commonJS({
  "node_modules/text-decoder/lib/utf8-decoder.js"(exports2, module2) {
    var b4a = require_b4a();
    module2.exports = class UTF8Decoder {
      constructor() {
        this._reset();
      }
      get remaining() {
        return this.bytesSeen;
      }
      decode(data) {
        if (data.byteLength === 0) return "";
        if (this.bytesNeeded === 0 && trailingIncomplete(data, 0) === 0) {
          this.bytesSeen = trailingBytesSeen(data);
          return b4a.toString(data, "utf8");
        }
        let result = "";
        let start = 0;
        if (this.bytesNeeded > 0) {
          while (start < data.byteLength) {
            const byte = data[start];
            if (byte < this.lowerBoundary || byte > this.upperBoundary) {
              result += "\uFFFD";
              this._reset();
              break;
            }
            this.lowerBoundary = 128;
            this.upperBoundary = 191;
            this.codePoint = this.codePoint << 6 | byte & 63;
            this.bytesSeen++;
            start++;
            if (this.bytesSeen === this.bytesNeeded) {
              result += String.fromCodePoint(this.codePoint);
              this._reset();
              break;
            }
          }
          if (this.bytesNeeded > 0) return result;
        }
        const trailing = trailingIncomplete(data, start);
        const end = data.byteLength - trailing;
        if (end > start) result += b4a.toString(data, "utf8", start, end);
        for (let i = end; i < data.byteLength; i++) {
          const byte = data[i];
          if (this.bytesNeeded === 0) {
            if (byte <= 127) {
              this.bytesSeen = 0;
              result += String.fromCharCode(byte);
            } else if (byte >= 194 && byte <= 223) {
              this.bytesNeeded = 2;
              this.bytesSeen = 1;
              this.codePoint = byte & 31;
            } else if (byte >= 224 && byte <= 239) {
              if (byte === 224) this.lowerBoundary = 160;
              else if (byte === 237) this.upperBoundary = 159;
              this.bytesNeeded = 3;
              this.bytesSeen = 1;
              this.codePoint = byte & 15;
            } else if (byte >= 240 && byte <= 244) {
              if (byte === 240) this.lowerBoundary = 144;
              else if (byte === 244) this.upperBoundary = 143;
              this.bytesNeeded = 4;
              this.bytesSeen = 1;
              this.codePoint = byte & 7;
            } else {
              this.bytesSeen = 1;
              result += "\uFFFD";
            }
            continue;
          }
          if (byte < this.lowerBoundary || byte > this.upperBoundary) {
            result += "\uFFFD";
            i--;
            this._reset();
            continue;
          }
          this.lowerBoundary = 128;
          this.upperBoundary = 191;
          this.codePoint = this.codePoint << 6 | byte & 63;
          this.bytesSeen++;
          if (this.bytesSeen === this.bytesNeeded) {
            result += String.fromCodePoint(this.codePoint);
            this._reset();
          }
        }
        return result;
      }
      flush() {
        const result = this.bytesNeeded > 0 ? "\uFFFD" : "";
        this._reset();
        return result;
      }
      _reset() {
        this.codePoint = 0;
        this.bytesNeeded = 0;
        this.bytesSeen = 0;
        this.lowerBoundary = 128;
        this.upperBoundary = 191;
      }
    };
    function trailingIncomplete(data, start) {
      const len = data.byteLength;
      if (len <= start) return 0;
      const limit = Math.max(start, len - 4);
      let i = len - 1;
      while (i > limit && (data[i] & 192) === 128) i--;
      if (i < start) return 0;
      const byte = data[i];
      let needed;
      if (byte <= 127) return 0;
      if (byte >= 194 && byte <= 223) needed = 2;
      else if (byte >= 224 && byte <= 239) needed = 3;
      else if (byte >= 240 && byte <= 244) needed = 4;
      else return 0;
      const available = len - i;
      return available < needed ? available : 0;
    }
    function trailingBytesSeen(data) {
      const len = data.byteLength;
      if (len === 0) return 0;
      const last = data[len - 1];
      if (last <= 127) return 0;
      if ((last & 192) !== 128) return 1;
      const limit = Math.max(0, len - 4);
      let i = len - 2;
      while (i >= limit && (data[i] & 192) === 128) i--;
      if (i < 0) return 1;
      const first = data[i];
      let needed;
      if (first >= 194 && first <= 223) needed = 2;
      else if (first >= 224 && first <= 239) needed = 3;
      else if (first >= 240 && first <= 244) needed = 4;
      else return 1;
      if (len - i !== needed) return 1;
      if (needed >= 3) {
        const second = data[i + 1];
        if (first === 224 && second < 160) return 1;
        if (first === 237 && second > 159) return 1;
        if (first === 240 && second < 144) return 1;
        if (first === 244 && second > 143) return 1;
      }
      return 0;
    }
  }
});

// node_modules/text-decoder/index.js
var require_text_decoder = __commonJS({
  "node_modules/text-decoder/index.js"(exports2, module2) {
    var PassThroughDecoder = require_pass_through_decoder();
    var UTF8Decoder = require_utf8_decoder();
    module2.exports = class TextDecoder {
      constructor(encoding = "utf8") {
        this.encoding = normalizeEncoding(encoding);
        switch (this.encoding) {
          case "utf8":
            this.decoder = new UTF8Decoder();
            break;
          case "utf16le":
          case "base64":
            throw new Error("Unsupported encoding: " + this.encoding);
          default:
            this.decoder = new PassThroughDecoder(this.encoding);
        }
      }
      get remaining() {
        return this.decoder.remaining;
      }
      push(data) {
        if (typeof data === "string") return data;
        return this.decoder.decode(data);
      }
      // For Node.js compatibility
      write(data) {
        return this.push(data);
      }
      end(data) {
        let result = "";
        if (data) result = this.push(data);
        result += this.decoder.flush();
        return result;
      }
    };
    function normalizeEncoding(encoding) {
      encoding = encoding.toLowerCase();
      switch (encoding) {
        case "utf8":
        case "utf-8":
          return "utf8";
        case "ucs2":
        case "ucs-2":
        case "utf16le":
        case "utf-16le":
          return "utf16le";
        case "latin1":
        case "binary":
          return "latin1";
        case "base64":
        case "ascii":
        case "hex":
          return encoding;
        default:
          throw new Error("Unknown encoding: " + encoding);
      }
    }
  }
});

// node_modules/streamx/lib/errors.js
var require_errors = __commonJS({
  "node_modules/streamx/lib/errors.js"(exports2, module2) {
    module2.exports = class StreamError extends Error {
      constructor(msg, code, fn = StreamError) {
        super(msg);
        this.code = code;
        if (Error.captureStackTrace) {
          Error.captureStackTrace(this, fn);
        }
      }
      static isStreamDestroyed(err) {
        return err && err.code === "STREAM_DESTROYED";
      }
      static isPrematureClose(err) {
        return err && err.code === "PREMATURE_CLOSE";
      }
      static isAborted(err) {
        return err && err.code === "ABORTED";
      }
      static isBadArgument(err) {
        return err && err.code === "BAD_ARGUMENT";
      }
      get name() {
        return "StreamError";
      }
      static STREAM_DESTROYED() {
        return new StreamError("Stream was destroyed", "STREAM_DESTROYED", StreamError.STREAM_DESTROYED);
      }
      static PREMATURE_CLOSE(msg = "Premature close") {
        return new StreamError(msg, "PREMATURE_CLOSE", StreamError.PREMATURE_CLOSE);
      }
      static ABORTED() {
        return new StreamError("Stream aborted", "ABORTED", StreamError.ABORTED);
      }
      static BAD_ARGUMENT(msg = "Bad argument") {
        return new StreamError(msg, "BAD_ARGUMENT", StreamError.BAD_ARGUMENT);
      }
    };
  }
});

// node_modules/streamx/index.js
var require_streamx = __commonJS({
  "node_modules/streamx/index.js"(exports2, module2) {
    var { EventEmitter } = require_default();
    var FIFO = require_fast_fifo();
    var TextDecoder = require_text_decoder();
    var StreamError = require_errors();
    var qmt = typeof queueMicrotask === "undefined" ? (fn) => global.process.nextTick(fn) : queueMicrotask;
    var MAX = (1 << 29) - 1;
    var OPENING = 1;
    var PREDESTROYING = 2;
    var DESTROYING = 4;
    var DESTROYED = 8;
    var NOT_OPENING = MAX ^ OPENING;
    var NOT_PREDESTROYING = MAX ^ PREDESTROYING;
    var READ_ACTIVE = 1 << 4;
    var READ_UPDATING = 2 << 4;
    var READ_PRIMARY = 4 << 4;
    var READ_QUEUED = 8 << 4;
    var READ_RESUMED = 16 << 4;
    var READ_PIPE_DRAINED = 32 << 4;
    var READ_ENDING = 64 << 4;
    var READ_EMIT_DATA = 128 << 4;
    var READ_EMIT_READABLE = 256 << 4;
    var READ_EMITTED_READABLE = 512 << 4;
    var READ_DONE = 1024 << 4;
    var READ_NEXT_TICK = 2048 << 4;
    var READ_NEEDS_PUSH = 4096 << 4;
    var READ_READ_AHEAD = 8192 << 4;
    var READ_FLOWING = READ_RESUMED | READ_PIPE_DRAINED;
    var READ_ACTIVE_AND_NEEDS_PUSH = READ_ACTIVE | READ_NEEDS_PUSH;
    var READ_PRIMARY_AND_ACTIVE = READ_PRIMARY | READ_ACTIVE;
    var READ_EMIT_READABLE_AND_QUEUED = READ_EMIT_READABLE | READ_QUEUED;
    var READ_RESUMED_READ_AHEAD = READ_RESUMED | READ_READ_AHEAD;
    var READ_NOT_ACTIVE = MAX ^ READ_ACTIVE;
    var READ_NON_PRIMARY = MAX ^ READ_PRIMARY;
    var READ_NON_PRIMARY_AND_PUSHED = MAX ^ (READ_PRIMARY | READ_NEEDS_PUSH);
    var READ_PUSHED = MAX ^ READ_NEEDS_PUSH;
    var READ_PAUSED = MAX ^ READ_RESUMED;
    var READ_NOT_QUEUED = MAX ^ (READ_QUEUED | READ_EMITTED_READABLE);
    var READ_NOT_ENDING = MAX ^ READ_ENDING;
    var READ_PIPE_NOT_DRAINED = MAX ^ READ_FLOWING;
    var READ_NOT_NEXT_TICK = MAX ^ READ_NEXT_TICK;
    var READ_NOT_UPDATING = MAX ^ READ_UPDATING;
    var READ_NO_READ_AHEAD = MAX ^ READ_READ_AHEAD;
    var READ_PAUSED_NO_READ_AHEAD = MAX ^ READ_RESUMED_READ_AHEAD;
    var WRITE_ACTIVE = 1 << 18;
    var WRITE_UPDATING = 2 << 18;
    var WRITE_PRIMARY = 4 << 18;
    var WRITE_QUEUED = 8 << 18;
    var WRITE_UNDRAINED = 16 << 18;
    var WRITE_DONE = 32 << 18;
    var WRITE_EMIT_DRAIN = 64 << 18;
    var WRITE_NEXT_TICK = 128 << 18;
    var WRITE_WRITING = 256 << 18;
    var WRITE_FINISHING = 512 << 18;
    var WRITE_CORKED = 1024 << 18;
    var WRITE_NOT_ACTIVE = MAX ^ (WRITE_ACTIVE | WRITE_WRITING);
    var WRITE_NON_PRIMARY = MAX ^ WRITE_PRIMARY;
    var WRITE_NOT_FINISHING = MAX ^ (WRITE_ACTIVE | WRITE_FINISHING);
    var WRITE_DRAINED = MAX ^ WRITE_UNDRAINED;
    var WRITE_NOT_QUEUED = MAX ^ WRITE_QUEUED;
    var WRITE_NOT_NEXT_TICK = MAX ^ WRITE_NEXT_TICK;
    var WRITE_NOT_UPDATING = MAX ^ WRITE_UPDATING;
    var WRITE_NOT_CORKED = MAX ^ WRITE_CORKED;
    var ACTIVE = READ_ACTIVE | WRITE_ACTIVE;
    var NOT_ACTIVE = MAX ^ ACTIVE;
    var DONE = READ_DONE | WRITE_DONE;
    var DESTROY_STATUS = DESTROYING | DESTROYED | PREDESTROYING;
    var OPEN_STATUS = DESTROY_STATUS | OPENING;
    var AUTO_DESTROY = DESTROY_STATUS | DONE;
    var NON_PRIMARY = WRITE_NON_PRIMARY & READ_NON_PRIMARY;
    var ACTIVE_OR_TICKING = WRITE_NEXT_TICK | READ_NEXT_TICK;
    var TICKING = ACTIVE_OR_TICKING & NOT_ACTIVE;
    var IS_OPENING = OPEN_STATUS | TICKING;
    var READ_PRIMARY_STATUS = OPEN_STATUS | READ_ENDING | READ_DONE;
    var READ_STATUS = OPEN_STATUS | READ_DONE | READ_QUEUED;
    var READ_ENDING_STATUS = OPEN_STATUS | READ_ENDING | READ_QUEUED;
    var READ_READABLE_STATUS = OPEN_STATUS | READ_EMIT_READABLE | READ_QUEUED | READ_EMITTED_READABLE;
    var SHOULD_NOT_READ = OPEN_STATUS | READ_ACTIVE | READ_ENDING | READ_DONE | READ_NEEDS_PUSH | READ_READ_AHEAD;
    var READ_BACKPRESSURE_STATUS = DESTROY_STATUS | READ_ENDING | READ_DONE;
    var READ_UPDATE_SYNC_STATUS = READ_UPDATING | OPEN_STATUS | READ_NEXT_TICK | READ_PRIMARY;
    var READ_NEXT_TICK_OR_OPENING = READ_NEXT_TICK | OPENING;
    var WRITE_PRIMARY_STATUS = OPEN_STATUS | WRITE_FINISHING | WRITE_DONE;
    var WRITE_QUEUED_AND_UNDRAINED = WRITE_QUEUED | WRITE_UNDRAINED;
    var WRITE_QUEUED_AND_ACTIVE = WRITE_QUEUED | WRITE_ACTIVE;
    var WRITE_DRAIN_STATUS = WRITE_QUEUED | WRITE_UNDRAINED | OPEN_STATUS | WRITE_ACTIVE;
    var WRITE_STATUS = OPEN_STATUS | WRITE_ACTIVE | WRITE_QUEUED | WRITE_CORKED;
    var WRITE_PRIMARY_AND_ACTIVE = WRITE_PRIMARY | WRITE_ACTIVE;
    var WRITE_ACTIVE_AND_WRITING = WRITE_ACTIVE | WRITE_WRITING;
    var WRITE_FINISHING_STATUS = OPEN_STATUS | WRITE_FINISHING | WRITE_QUEUED_AND_ACTIVE | WRITE_DONE;
    var WRITE_BACKPRESSURE_STATUS = WRITE_UNDRAINED | DESTROY_STATUS | WRITE_FINISHING | WRITE_DONE;
    var WRITE_UPDATE_SYNC_STATUS = WRITE_UPDATING | OPEN_STATUS | WRITE_NEXT_TICK | WRITE_PRIMARY;
    var WRITE_DROP_DATA = WRITE_FINISHING | WRITE_DONE | DESTROY_STATUS;
    var asyncIterator = Symbol.asyncIterator || Symbol("asyncIterator");
    var WritableState = class {
      constructor(stream, { highWaterMark = 16384, map = null, mapWritable, byteLength, byteLengthWritable } = {}) {
        this.stream = stream;
        this.queue = new FIFO();
        this.highWaterMark = highWaterMark;
        this.buffered = 0;
        this.error = null;
        this.pipeline = null;
        this.drains = null;
        this.byteLength = byteLengthWritable || byteLength || defaultByteLength;
        this.map = mapWritable || map;
        this.afterWrite = afterWrite.bind(this);
        this.afterUpdateNextTick = updateWriteNT.bind(this);
      }
      get ending() {
        return (this.stream._duplexState & WRITE_FINISHING) !== 0;
      }
      get ended() {
        return (this.stream._duplexState & WRITE_DONE) !== 0;
      }
      push(data) {
        if ((this.stream._duplexState & WRITE_DROP_DATA) !== 0) return false;
        if (this.map !== null) data = this.map(data);
        this.buffered += this.byteLength(data);
        this.queue.push(data);
        if (this.buffered < this.highWaterMark) {
          this.stream._duplexState |= WRITE_QUEUED;
          return true;
        }
        this.stream._duplexState |= WRITE_QUEUED_AND_UNDRAINED;
        return false;
      }
      shift() {
        const data = this.queue.shift();
        this.buffered -= this.byteLength(data);
        if (this.buffered === 0) this.stream._duplexState &= WRITE_NOT_QUEUED;
        return data;
      }
      end(data) {
        if (typeof data === "function") {
          this.stream.once("finish", data);
        } else if (data !== void 0 && data !== null) {
          this.push(data);
        }
        this.stream._duplexState = (this.stream._duplexState | WRITE_FINISHING) & WRITE_NON_PRIMARY;
      }
      autoBatch(data, cb) {
        const buffer = [];
        const stream = this.stream;
        buffer.push(data);
        while ((stream._duplexState & WRITE_STATUS) === WRITE_QUEUED_AND_ACTIVE) {
          buffer.push(stream._writableState.shift());
        }
        if ((stream._duplexState & OPEN_STATUS) !== 0) return cb(null);
        stream._writev(buffer, cb);
      }
      update() {
        const stream = this.stream;
        stream._duplexState |= WRITE_UPDATING;
        do {
          while ((stream._duplexState & WRITE_STATUS) === WRITE_QUEUED) {
            const data = this.shift();
            stream._duplexState |= WRITE_ACTIVE_AND_WRITING;
            stream._write(data, this.afterWrite);
          }
          if ((stream._duplexState & WRITE_PRIMARY_AND_ACTIVE) === 0) this.updateNonPrimary();
        } while (this.continueUpdate() === true);
        stream._duplexState &= WRITE_NOT_UPDATING;
      }
      updateNonPrimary() {
        const stream = this.stream;
        if ((stream._duplexState & WRITE_FINISHING_STATUS) === WRITE_FINISHING) {
          stream._duplexState = stream._duplexState | WRITE_ACTIVE;
          stream._final(afterFinal.bind(this));
          return;
        }
        if ((stream._duplexState & DESTROY_STATUS) === DESTROYING) {
          if ((stream._duplexState & ACTIVE_OR_TICKING) === 0) {
            stream._duplexState |= ACTIVE;
            stream._destroy(afterDestroy.bind(this));
          }
          return;
        }
        if ((stream._duplexState & IS_OPENING) === OPENING) {
          stream._duplexState = (stream._duplexState | ACTIVE) & NOT_OPENING;
          stream._open(afterOpen.bind(this));
        }
      }
      continueUpdate() {
        if ((this.stream._duplexState & WRITE_NEXT_TICK) === 0) return false;
        this.stream._duplexState &= WRITE_NOT_NEXT_TICK;
        return true;
      }
      updateCallback() {
        if ((this.stream._duplexState & WRITE_UPDATE_SYNC_STATUS) === WRITE_PRIMARY) {
          this.update();
        } else {
          this.updateNextTick();
        }
      }
      updateNextTick() {
        if ((this.stream._duplexState & WRITE_NEXT_TICK) !== 0) return;
        this.stream._duplexState |= WRITE_NEXT_TICK;
        if ((this.stream._duplexState & WRITE_UPDATING) === 0) qmt(this.afterUpdateNextTick);
      }
    };
    var ReadableState = class {
      constructor(stream, { highWaterMark = 16384, map = null, mapReadable, byteLength, byteLengthReadable } = {}) {
        this.stream = stream;
        this.queue = new FIFO();
        this.highWaterMark = highWaterMark === 0 ? 1 : highWaterMark;
        this.buffered = 0;
        this.readAhead = highWaterMark > 0;
        this.error = null;
        this.pipeline = null;
        this.byteLength = byteLengthReadable || byteLength || defaultByteLength;
        this.map = mapReadable || map;
        this.pipeTo = null;
        this.afterRead = afterRead.bind(this);
        this.afterUpdateNextTick = updateReadNT.bind(this);
      }
      get ending() {
        return (this.stream._duplexState & READ_ENDING) !== 0;
      }
      get ended() {
        return (this.stream._duplexState & READ_DONE) !== 0;
      }
      pipe(pipeTo, cb) {
        if (this.pipeTo !== null) throw StreamError.BAD_ARGUMENT("Can only pipe to one destination");
        if (typeof cb !== "function") cb = null;
        this.stream._duplexState |= READ_PIPE_DRAINED;
        this.pipeTo = pipeTo;
        this.pipeline = new Pipeline(this.stream, pipeTo, cb);
        if (cb) this.stream.on("error", noop);
        if (isStreamx(pipeTo)) {
          pipeTo._writableState.pipeline = this.pipeline;
          if (cb) pipeTo.on("error", noop);
          pipeTo.on("finish", this.pipeline.finished.bind(this.pipeline));
        } else {
          const onerror = this.pipeline.done.bind(this.pipeline, pipeTo);
          const onclose = this.pipeline.done.bind(this.pipeline, pipeTo, null);
          pipeTo.on("error", onerror);
          pipeTo.on("close", onclose);
          pipeTo.on("finish", this.pipeline.finished.bind(this.pipeline));
        }
        pipeTo.on("drain", afterDrain.bind(this));
        this.stream.emit("piping", pipeTo);
        pipeTo.emit("pipe", this.stream);
      }
      push(data) {
        const stream = this.stream;
        if (data === null) {
          this.highWaterMark = 0;
          stream._duplexState = (stream._duplexState | READ_ENDING) & READ_NON_PRIMARY_AND_PUSHED;
          return false;
        }
        if (this.map !== null) {
          data = this.map(data);
          if (data === null) {
            stream._duplexState &= READ_PUSHED;
            return this.buffered < this.highWaterMark;
          }
        }
        this.buffered += this.byteLength(data);
        this.queue.push(data);
        stream._duplexState = (stream._duplexState | READ_QUEUED) & READ_PUSHED;
        return this.buffered < this.highWaterMark;
      }
      shift() {
        const data = this.queue.shift();
        this.buffered -= this.byteLength(data);
        if (this.buffered === 0) {
          this.stream._duplexState &= READ_NOT_QUEUED;
        }
        return data;
      }
      unshift(data) {
        const pending = [this.map !== null ? this.map(data) : data];
        while (this.buffered > 0) pending.push(this.shift());
        for (let i = 0; i < pending.length - 1; i++) {
          const data2 = pending[i];
          this.buffered += this.byteLength(data2);
          this.queue.push(data2);
        }
        this.push(pending[pending.length - 1]);
      }
      read() {
        const stream = this.stream;
        if ((stream._duplexState & READ_STATUS) === READ_QUEUED) {
          const data = this.shift();
          if (this.pipeTo !== null && this.pipeTo.write(data) === false) {
            stream._duplexState &= READ_PIPE_NOT_DRAINED;
          }
          if ((stream._duplexState & READ_EMIT_DATA) !== 0) {
            stream.emit("data", data);
          }
          return data;
        }
        if (this.readAhead === false) {
          stream._duplexState |= READ_READ_AHEAD;
          this.updateNextTick();
        }
        return null;
      }
      drain() {
        const stream = this.stream;
        while ((stream._duplexState & READ_STATUS) === READ_QUEUED && (stream._duplexState & READ_FLOWING) !== 0) {
          const data = this.shift();
          if (this.pipeTo !== null && this.pipeTo.write(data) === false) {
            stream._duplexState &= READ_PIPE_NOT_DRAINED;
          }
          if ((stream._duplexState & READ_EMIT_DATA) !== 0) {
            stream.emit("data", data);
          }
        }
      }
      update() {
        const stream = this.stream;
        stream._duplexState |= READ_UPDATING;
        do {
          this.drain();
          while (this.buffered < this.highWaterMark && (stream._duplexState & SHOULD_NOT_READ) === READ_READ_AHEAD) {
            stream._duplexState |= READ_ACTIVE_AND_NEEDS_PUSH;
            stream._read(this.afterRead);
            this.drain();
          }
          if ((stream._duplexState & READ_READABLE_STATUS) === READ_EMIT_READABLE_AND_QUEUED) {
            stream._duplexState |= READ_EMITTED_READABLE;
            stream.emit("readable");
          }
          if ((stream._duplexState & READ_PRIMARY_AND_ACTIVE) === 0) {
            this.updateNonPrimary();
          }
        } while (this.continueUpdate() === true);
        stream._duplexState &= READ_NOT_UPDATING;
      }
      updateNonPrimary() {
        const stream = this.stream;
        if ((stream._duplexState & READ_ENDING_STATUS) === READ_ENDING) {
          stream._duplexState = (stream._duplexState | READ_DONE) & READ_NOT_ENDING;
          stream.emit("end");
          if ((stream._duplexState & AUTO_DESTROY) === DONE) {
            stream._duplexState |= DESTROYING;
          }
          if (this.pipeTo !== null) {
            this.pipeTo.end();
          }
        }
        if ((stream._duplexState & DESTROY_STATUS) === DESTROYING) {
          if ((stream._duplexState & ACTIVE_OR_TICKING) === 0) {
            stream._duplexState |= ACTIVE;
            stream._destroy(afterDestroy.bind(this));
          }
          return;
        }
        if ((stream._duplexState & IS_OPENING) === OPENING) {
          stream._duplexState = (stream._duplexState | ACTIVE) & NOT_OPENING;
          stream._open(afterOpen.bind(this));
        }
      }
      continueUpdate() {
        if ((this.stream._duplexState & READ_NEXT_TICK) === 0) return false;
        this.stream._duplexState &= READ_NOT_NEXT_TICK;
        return true;
      }
      updateCallback() {
        if ((this.stream._duplexState & READ_UPDATE_SYNC_STATUS) === READ_PRIMARY) {
          this.update();
        } else {
          this.updateNextTick();
        }
      }
      updateNextTickIfOpen() {
        if ((this.stream._duplexState & READ_NEXT_TICK_OR_OPENING) !== 0) return;
        this.stream._duplexState |= READ_NEXT_TICK;
        if ((this.stream._duplexState & READ_UPDATING) === 0) qmt(this.afterUpdateNextTick);
      }
      updateNextTick() {
        if ((this.stream._duplexState & READ_NEXT_TICK) !== 0) return;
        this.stream._duplexState |= READ_NEXT_TICK;
        if ((this.stream._duplexState & READ_UPDATING) === 0) qmt(this.afterUpdateNextTick);
      }
    };
    var TransformState = class {
      constructor(stream) {
        this.data = null;
        this.afterTransform = afterTransform.bind(stream);
        this.afterFinal = null;
      }
    };
    var Pipeline = class {
      constructor(src, dst, cb) {
        this.from = src;
        this.to = dst;
        this.afterPipe = cb;
        this.error = null;
        this.pipeToFinished = false;
      }
      finished() {
        this.pipeToFinished = true;
      }
      done(stream, err) {
        if (err) this.error = err;
        if (stream === this.to) {
          this.to = null;
          if (this.from !== null) {
            if ((this.from._duplexState & READ_DONE) === 0 || !this.pipeToFinished) {
              this.from.destroy(this.error || StreamError.PREMATURE_CLOSE("Writable stream closed"));
            }
            return;
          }
        }
        if (stream === this.from) {
          this.from = null;
          if (this.to !== null) {
            if ((stream._duplexState & READ_DONE) === 0) {
              this.to.destroy(this.error || StreamError.PREMATURE_CLOSE("Readable stream closed"));
            }
            return;
          }
        }
        if (this.afterPipe !== null) this.afterPipe(this.error);
        this.to = this.from = this.afterPipe = null;
      }
    };
    function afterDrain() {
      this.stream._duplexState |= READ_PIPE_DRAINED;
      this.updateCallback();
    }
    function afterFinal(err) {
      const stream = this.stream;
      if (err) stream.destroy(err);
      if ((stream._duplexState & DESTROY_STATUS) === 0) {
        stream._duplexState |= WRITE_DONE;
        stream.emit("finish");
      }
      if ((stream._duplexState & AUTO_DESTROY) === DONE) {
        stream._duplexState |= DESTROYING;
      }
      stream._duplexState &= WRITE_NOT_FINISHING;
      if ((stream._duplexState & WRITE_UPDATING) === 0) {
        this.update();
      } else {
        this.updateNextTick();
      }
    }
    function afterDestroy(err) {
      const stream = this.stream;
      if (!err && !StreamError.isStreamDestroyed(this.error)) err = this.error;
      if (err) stream.emit("error", err);
      stream._duplexState |= DESTROYED;
      stream.emit("close");
      const rs = stream._readableState;
      const ws = stream._writableState;
      if (rs !== null && rs.pipeline !== null) {
        rs.pipeline.done(stream, err);
      }
      if (ws !== null) {
        while (ws.drains !== null && ws.drains.length > 0) {
          ws.drains.shift().resolve(false);
        }
        if (ws.pipeline !== null) {
          ws.pipeline.done(stream, err);
        }
      }
    }
    function afterWrite(err) {
      const stream = this.stream;
      if (err) stream.destroy(err);
      stream._duplexState &= WRITE_NOT_ACTIVE;
      if (this.drains !== null) tickDrains(this.drains);
      if ((stream._duplexState & WRITE_DRAIN_STATUS) === WRITE_UNDRAINED) {
        stream._duplexState &= WRITE_DRAINED;
        if ((stream._duplexState & WRITE_EMIT_DRAIN) === WRITE_EMIT_DRAIN) {
          stream.emit("drain");
        }
      }
      this.updateCallback();
    }
    function afterRead(err) {
      if (err) this.stream.destroy(err);
      this.stream._duplexState &= READ_NOT_ACTIVE;
      if (this.readAhead === false && (this.stream._duplexState & READ_RESUMED) === 0) {
        this.stream._duplexState &= READ_NO_READ_AHEAD;
      }
      this.updateCallback();
    }
    function updateReadNT() {
      if ((this.stream._duplexState & READ_UPDATING) === 0) {
        this.stream._duplexState &= READ_NOT_NEXT_TICK;
        this.update();
      }
    }
    function updateWriteNT() {
      if ((this.stream._duplexState & WRITE_UPDATING) === 0) {
        this.stream._duplexState &= WRITE_NOT_NEXT_TICK;
        this.update();
      }
    }
    function tickDrains(drains) {
      for (let i = 0; i < drains.length; i++) {
        if (--drains[i].writes === 0) {
          drains.shift().resolve(true);
          i--;
        }
      }
    }
    function afterOpen(err) {
      const stream = this.stream;
      if (err) stream.destroy(err);
      if ((stream._duplexState & DESTROYING) === 0) {
        if ((stream._duplexState & READ_PRIMARY_STATUS) === 0) {
          stream._duplexState |= READ_PRIMARY;
        }
        if ((stream._duplexState & WRITE_PRIMARY_STATUS) === 0) {
          stream._duplexState |= WRITE_PRIMARY;
        }
        stream.emit("open");
      }
      stream._duplexState &= NOT_ACTIVE;
      if (stream._writableState !== null) {
        stream._writableState.updateCallback();
      }
      if (stream._readableState !== null) {
        stream._readableState.updateCallback();
      }
    }
    function afterTransform(err, data) {
      if (data !== void 0 && data !== null) this.push(data);
      this._writableState.afterWrite(err);
    }
    function newListener(name) {
      if (this._readableState !== null) {
        if (name === "data") {
          this._duplexState |= READ_EMIT_DATA | READ_RESUMED_READ_AHEAD;
          this._readableState.updateNextTick();
        }
        if (name === "readable") {
          this._duplexState |= READ_EMIT_READABLE;
          this._readableState.updateNextTick();
        }
      }
      if (this._writableState !== null) {
        if (name === "drain") {
          this._duplexState |= WRITE_EMIT_DRAIN;
          this._writableState.updateNextTick();
        }
      }
    }
    var Stream = class extends EventEmitter {
      constructor(opts) {
        super();
        this._duplexState = 0;
        this._readableState = null;
        this._writableState = null;
        if (opts) {
          if (opts.open) this._open = opts.open;
          if (opts.destroy) this._destroy = opts.destroy;
          if (opts.predestroy) this._predestroy = opts.predestroy;
          if (opts.signal) opts.signal.addEventListener("abort", abort.bind(this));
        }
        this.on("newListener", newListener);
      }
      _open(cb) {
        cb(null);
      }
      _destroy(cb) {
        cb(null);
      }
      _predestroy() {
      }
      get readable() {
        return this._readableState !== null ? true : void 0;
      }
      get writable() {
        return this._writableState !== null ? true : void 0;
      }
      get destroyed() {
        return (this._duplexState & DESTROYED) !== 0;
      }
      get destroying() {
        return (this._duplexState & DESTROY_STATUS) !== 0;
      }
      destroy(err) {
        if ((this._duplexState & DESTROY_STATUS) === 0) {
          if (!err) err = StreamError.STREAM_DESTROYED();
          this._duplexState = (this._duplexState | DESTROYING) & NON_PRIMARY;
          if (this._readableState !== null) {
            this._readableState.highWaterMark = 0;
            this._readableState.error = err;
          }
          if (this._writableState !== null) {
            this._writableState.highWaterMark = 0;
            this._writableState.error = err;
          }
          this._duplexState |= PREDESTROYING;
          this._predestroy();
          this._duplexState &= NOT_PREDESTROYING;
          if (this._readableState !== null) {
            this._readableState.updateNextTick();
          }
          if (this._writableState !== null) {
            this._writableState.updateNextTick();
          }
        }
      }
    };
    var Readable3 = class _Readable extends Stream {
      constructor(opts) {
        super(opts);
        this._duplexState |= OPENING | WRITE_DONE | READ_READ_AHEAD;
        this._readableState = new ReadableState(this, opts);
        if (opts) {
          if (this._readableState.readAhead === false) this._duplexState &= READ_NO_READ_AHEAD;
          if (opts.read) this._read = opts.read;
          if (opts.eagerOpen) this._readableState.updateNextTick();
          if (opts.encoding) this.setEncoding(opts.encoding);
        }
      }
      static deferred(fn, opts) {
        const out = new PassThrough(opts);
        fn().then((src) => {
          if (src === null) return out.end();
          if (out.destroying) return;
          pipeline2(src, out, noop);
        }).catch((err) => out.destroy(err));
        return out;
      }
      setEncoding(encoding) {
        const dec = new TextDecoder(encoding);
        const map = this._readableState.map || echo;
        this._readableState.map = mapOrSkip;
        return this;
        function mapOrSkip(data) {
          const next = dec.push(data);
          return next === "" && (data.byteLength !== 0 || dec.remaining > 0) ? null : map(next);
        }
      }
      _read(cb) {
        cb(null);
      }
      pipe(dest, cb) {
        this._readableState.updateNextTick();
        this._readableState.pipe(dest, cb);
        return dest;
      }
      read() {
        this._readableState.updateNextTick();
        return this._readableState.read();
      }
      push(data) {
        this._readableState.updateNextTickIfOpen();
        return this._readableState.push(data);
      }
      unshift(data) {
        this._readableState.updateNextTickIfOpen();
        return this._readableState.unshift(data);
      }
      resume() {
        this._duplexState |= READ_RESUMED_READ_AHEAD;
        this._readableState.updateNextTick();
        return this;
      }
      pause() {
        this._duplexState &= this._readableState.readAhead === false ? READ_PAUSED_NO_READ_AHEAD : READ_PAUSED;
        return this;
      }
      static _fromAsyncIterator(ite, opts) {
        let destroy;
        const rs = new _Readable({
          ...opts,
          read(cb) {
            ite.next().then(push).then(cb.bind(null, null)).catch(cb);
          },
          predestroy() {
            destroy = ite.return();
          },
          destroy(cb) {
            if (!destroy) return cb(null);
            destroy.then(cb.bind(null, null)).catch(cb);
          }
        });
        return rs;
        function push(data) {
          if (data.done) rs.push(null);
          else rs.push(data.value);
        }
      }
      static from(data, opts) {
        if (isReadStreamx(data)) return data;
        if (data[asyncIterator]) return this._fromAsyncIterator(data[asyncIterator](), opts);
        if (!Array.isArray(data)) data = data === void 0 ? [] : [data];
        let i = 0;
        return new _Readable({
          ...opts,
          read(cb) {
            this.push(i === data.length ? null : data[i++]);
            cb(null);
          }
        });
      }
      static isBackpressured(rs) {
        return (rs._duplexState & READ_BACKPRESSURE_STATUS) !== 0 || rs._readableState.buffered >= rs._readableState.highWaterMark;
      }
      static isPaused(rs) {
        return (rs._duplexState & READ_RESUMED) === 0;
      }
      [asyncIterator]() {
        const stream = this;
        let error = null;
        let promiseResolve = null;
        let promiseReject = null;
        this.on("error", (err) => {
          error = err;
        });
        this.on("readable", onreadable);
        this.on("close", onclose);
        return {
          [asyncIterator]() {
            return this;
          },
          next() {
            return new Promise(function(resolve, reject) {
              promiseResolve = resolve;
              promiseReject = reject;
              const data = stream.read();
              if (data !== null) ondata(data);
              else if ((stream._duplexState & DESTROYED) !== 0) ondata(null);
            });
          },
          return() {
            return destroy(null);
          },
          throw(err) {
            return destroy(err);
          }
        };
        function onreadable() {
          if (promiseResolve !== null) ondata(stream.read());
        }
        function onclose() {
          if (promiseResolve !== null) ondata(null);
        }
        function ondata(data) {
          if (promiseReject === null) return;
          if (error) {
            promiseReject(error);
          } else if (data === null && (stream._duplexState & READ_DONE) === 0) {
            promiseReject(StreamError.STREAM_DESTROYED());
          } else {
            promiseResolve({ value: data, done: data === null });
          }
          promiseReject = promiseResolve = null;
        }
        function destroy(err) {
          stream.destroy(err);
          return new Promise((resolve, reject) => {
            if (stream._duplexState & DESTROYED) return resolve({ value: void 0, done: true });
            stream.once("close", function() {
              if (err) reject(err);
              else resolve({ value: void 0, done: true });
            });
          });
        }
      }
    };
    var Writable = class extends Stream {
      constructor(opts) {
        super(opts);
        this._duplexState |= OPENING | READ_DONE;
        this._writableState = new WritableState(this, opts);
        if (opts) {
          if (opts.writev) this._writev = opts.writev;
          if (opts.write) this._write = opts.write;
          if (opts.final) this._final = opts.final;
          if (opts.eagerOpen) this._writableState.updateNextTick();
        }
      }
      cork() {
        this._duplexState |= WRITE_CORKED;
      }
      uncork() {
        this._duplexState &= WRITE_NOT_CORKED;
        this._writableState.updateNextTick();
      }
      _writev(batch, cb) {
        cb(null);
      }
      _write(data, cb) {
        this._writableState.autoBatch(data, cb);
      }
      _final(cb) {
        cb(null);
      }
      static isBackpressured(ws) {
        return (ws._duplexState & WRITE_BACKPRESSURE_STATUS) !== 0;
      }
      static drained(ws) {
        if (ws.destroyed) return Promise.resolve(false);
        const state = ws._writableState;
        const pending = isWritev(ws) ? Math.min(1, state.queue.length) : state.queue.length;
        const writes = pending + (ws._duplexState & WRITE_WRITING ? 1 : 0);
        if (writes === 0) return Promise.resolve(true);
        if (state.drains === null) state.drains = [];
        return new Promise((resolve) => {
          state.drains.push({ writes, resolve });
        });
      }
      write(data) {
        this._writableState.updateNextTick();
        return this._writableState.push(data);
      }
      end(data) {
        this._writableState.updateNextTick();
        this._writableState.end(data);
        return this;
      }
    };
    var Duplex = class extends Readable3 {
      // and Writable
      constructor(opts) {
        super(opts);
        this._duplexState = OPENING | this._duplexState & READ_READ_AHEAD;
        this._writableState = new WritableState(this, opts);
        if (opts) {
          if (opts.writev) this._writev = opts.writev;
          if (opts.write) this._write = opts.write;
          if (opts.final) this._final = opts.final;
        }
      }
      cork() {
        this._duplexState |= WRITE_CORKED;
      }
      uncork() {
        this._duplexState &= WRITE_NOT_CORKED;
        this._writableState.updateNextTick();
      }
      _writev(batch, cb) {
        cb(null);
      }
      _write(data, cb) {
        this._writableState.autoBatch(data, cb);
      }
      _final(cb) {
        cb(null);
      }
      write(data) {
        this._writableState.updateNextTick();
        return this._writableState.push(data);
      }
      end(data) {
        this._writableState.updateNextTick();
        this._writableState.end(data);
        return this;
      }
    };
    var Transform = class extends Duplex {
      constructor(opts) {
        super(opts);
        this._transformState = new TransformState(this);
        if (opts) {
          if (opts.transform) this._transform = opts.transform;
          if (opts.flush) this._flush = opts.flush;
        }
      }
      _write(data, cb) {
        if (this._readableState.buffered >= this._readableState.highWaterMark) {
          this._transformState.data = data;
        } else {
          this._transform(data, this._transformState.afterTransform);
        }
      }
      _read(cb) {
        if (this._transformState.data !== null) {
          const data = this._transformState.data;
          this._transformState.data = null;
          cb(null);
          this._transform(data, this._transformState.afterTransform);
        } else {
          cb(null);
        }
      }
      destroy(err) {
        super.destroy(err);
        if (this._transformState.data !== null) {
          this._transformState.data = null;
          this._transformState.afterTransform();
        }
      }
      _transform(data, cb) {
        cb(null, data);
      }
      _flush(cb) {
        cb(null);
      }
      _final(cb) {
        this._transformState.afterFinal = cb;
        this._flush(transformAfterFlush.bind(this));
      }
    };
    var PassThrough = class extends Transform {
    };
    function transformAfterFlush(err, data) {
      const cb = this._transformState.afterFinal;
      if (err) return cb(err);
      if (data !== null && data !== void 0) this.push(data);
      this.push(null);
      cb(null);
    }
    function pipelinePromise(...streams) {
      return new Promise((resolve, reject) => {
        return pipeline2(...streams, (err) => {
          if (err) return reject(err);
          resolve();
        });
      });
    }
    function pipeline2(stream, ...streams) {
      const all = Array.isArray(stream) ? [...stream, ...streams] : [stream, ...streams];
      const done = all.length && typeof all[all.length - 1] === "function" ? all.pop() : null;
      if (all.length < 2) throw StreamError.BAD_ARGUMENT("Pipeline requires at least 2 streams");
      let src = all[0];
      let dest = null;
      let error = null;
      for (let i = 1; i < all.length; i++) {
        dest = all[i];
        if (isStreamx(src)) {
          src.pipe(dest, onerror);
        } else {
          errorHandle(src, true, i > 1, onerror);
          src.pipe(dest);
        }
        src = dest;
      }
      if (done) {
        let fin = false;
        const autoDestroy = isStreamx(dest) || !!(dest._writableState && dest._writableState.autoDestroy);
        dest.on("error", (err) => {
          if (error === null) error = err;
        });
        dest.on("finish", () => {
          fin = true;
          if (!autoDestroy) done(error);
        });
        if (autoDestroy) {
          dest.on("close", () => done(error || (fin ? null : StreamError.PREMATURE_CLOSE())));
        }
      }
      return dest;
      function errorHandle(s, rd, wr, onerror2) {
        s.on("error", onerror2);
        s.on("close", onclose);
        function onclose() {
          if (rd && s._readableState && !s._readableState.ended) {
            return onerror2(StreamError.PREMATURE_CLOSE());
          }
          if (wr && s._writableState && !s._writableState.ended) {
            return onerror2(StreamError.PREMATURE_CLOSE());
          }
        }
      }
      function onerror(err) {
        if (!err || error) return;
        error = err;
        for (const s of all) {
          s.destroy(err);
        }
      }
    }
    function echo(s) {
      return s;
    }
    function isStream(stream) {
      return !!stream._readableState || !!stream._writableState;
    }
    function isStreamx(stream) {
      return typeof stream._duplexState === "number" && isStream(stream);
    }
    function isEnding(stream) {
      return !!stream._readableState && stream._readableState.ending;
    }
    function isEnded(stream) {
      return !!stream._readableState && stream._readableState.ended;
    }
    function isFinishing(stream) {
      return !!stream._writableState && stream._writableState.ending;
    }
    function isFinished(stream) {
      return !!stream._writableState && stream._writableState.ended;
    }
    function getStreamError(stream, opts = {}) {
      const err = stream._readableState && stream._readableState.error || stream._writableState && stream._writableState.error;
      return !opts.all && StreamError.isStreamDestroyed(err) ? null : err;
    }
    function isReadStreamx(stream) {
      return isStreamx(stream) && stream.readable;
    }
    function isDisturbed(stream) {
      return (stream._duplexState & OPENING) !== OPENING || (stream._duplexState & DESTROYING) === DESTROYING || (stream._duplexState & ACTIVE_OR_TICKING) !== 0;
    }
    function isTypedArray(data) {
      return typeof data === "object" && data !== null && typeof data.byteLength === "number";
    }
    function defaultByteLength(data) {
      return isTypedArray(data) ? data.byteLength : 1024;
    }
    function noop() {
    }
    function abort() {
      this.destroy(StreamError.ABORTED());
    }
    function isWritev(s) {
      return s._writev !== Writable.prototype._writev && s._writev !== Duplex.prototype._writev;
    }
    module2.exports = {
      pipeline: pipeline2,
      pipelinePromise,
      isStream,
      isStreamx,
      isEnding,
      isEnded,
      isFinishing,
      isFinished,
      isDisturbed,
      getStreamError,
      Stream,
      Writable,
      Readable: Readable3,
      Duplex,
      Transform,
      // Export PassThrough for compatibility with Node.js core's stream module
      PassThrough
    };
  }
});

// node_modules/tar-stream/headers.js
var require_headers = __commonJS({
  "node_modules/tar-stream/headers.js"(exports2) {
    var b4a = require_b4a();
    var ZEROS = "0000000000000000000";
    var SEVENS = "7777777777777777777";
    var ZERO_OFFSET = "0".charCodeAt(0);
    var USTAR_MAGIC = b4a.from([117, 115, 116, 97, 114, 0]);
    var USTAR_VER = b4a.from([ZERO_OFFSET, ZERO_OFFSET]);
    var GNU_MAGIC = b4a.from([117, 115, 116, 97, 114, 32]);
    var GNU_VER = b4a.from([32, 0]);
    var MASK = 4095;
    var MAGIC_OFFSET = 257;
    var VERSION_OFFSET = 263;
    exports2.decodeLongPath = function decodeLongPath(buf, encoding) {
      return decodeStr(buf, 0, buf.length, encoding);
    };
    exports2.encodePax = function encodePax(opts) {
      let result = "";
      if (opts.name) result += addLength(" path=" + opts.name + "\n");
      if (opts.linkname) result += addLength(" linkpath=" + opts.linkname + "\n");
      const pax = opts.pax;
      if (pax) {
        for (const key in pax) {
          result += addLength(" " + key + "=" + pax[key] + "\n");
        }
      }
      return b4a.from(result);
    };
    exports2.decodePax = function decodePax(buf) {
      const result = {};
      while (buf.length) {
        let i = 0;
        while (i < buf.length && buf[i] !== 32) i++;
        const len = parseInt(b4a.toString(buf.subarray(0, i)), 10);
        if (!len) return result;
        const b = b4a.toString(buf.subarray(i + 1, len - 1));
        const keyIndex = b.indexOf("=");
        if (keyIndex === -1) return result;
        result[b.slice(0, keyIndex)] = b.slice(keyIndex + 1);
        buf = buf.subarray(len);
      }
      return result;
    };
    exports2.encode = function encode(opts) {
      const buf = b4a.alloc(512);
      let name = opts.name;
      let prefix = "";
      if (opts.typeflag === 5 && name[name.length - 1] !== "/") name += "/";
      if (b4a.byteLength(name) !== name.length) return null;
      while (b4a.byteLength(name) > 100) {
        const i = name.indexOf("/");
        if (i === -1) return null;
        prefix += prefix ? "/" + name.slice(0, i) : name.slice(0, i);
        name = name.slice(i + 1);
      }
      if (b4a.byteLength(name) > 100 || b4a.byteLength(prefix) > 155) return null;
      if (opts.linkname && b4a.byteLength(opts.linkname) > 100) return null;
      b4a.write(buf, name);
      b4a.write(buf, encodeOct(opts.mode & MASK, 6), 100);
      b4a.write(buf, encodeOct(opts.uid, 6), 108);
      b4a.write(buf, encodeOct(opts.gid, 6), 116);
      encodeSize(opts.size, buf, 124);
      b4a.write(buf, encodeOct(opts.mtime.getTime() / 1e3 | 0, 11), 136);
      buf[156] = ZERO_OFFSET + toTypeflag(opts.type);
      if (opts.linkname) b4a.write(buf, opts.linkname, 157);
      b4a.copy(USTAR_MAGIC, buf, MAGIC_OFFSET);
      b4a.copy(USTAR_VER, buf, VERSION_OFFSET);
      if (opts.uname) b4a.write(buf, opts.uname, 265);
      if (opts.gname) b4a.write(buf, opts.gname, 297);
      b4a.write(buf, encodeOct(opts.devmajor || 0, 6), 329);
      b4a.write(buf, encodeOct(opts.devminor || 0, 6), 337);
      if (prefix) b4a.write(buf, prefix, 345);
      b4a.write(buf, encodeOct(cksum(buf), 6), 148);
      return buf;
    };
    exports2.decode = function decode(buf, filenameEncoding, allowUnknownFormat) {
      let typeflag = buf[156] === 0 ? 0 : buf[156] - ZERO_OFFSET;
      let name = decodeStr(buf, 0, 100, filenameEncoding);
      const mode = decodeOct(buf, 100, 8);
      const uid = decodeOct(buf, 108, 8);
      const gid = decodeOct(buf, 116, 8);
      const size = decodeOct(buf, 124, 12);
      const mtime = decodeOct(buf, 136, 12);
      const type = toType(typeflag);
      const linkname = buf[157] === 0 ? null : decodeStr(buf, 157, 100, filenameEncoding);
      const uname = decodeStr(buf, 265, 32);
      const gname = decodeStr(buf, 297, 32);
      const devmajor = decodeOct(buf, 329, 8);
      const devminor = decodeOct(buf, 337, 8);
      const c = cksum(buf);
      if (c === 8 * 32) return null;
      if (c !== decodeOct(buf, 148, 8)) throw new Error("Invalid tar header. Maybe the tar is corrupted or it needs to be gunzipped?");
      if (isUSTAR(buf)) {
        if (buf[345]) name = decodeStr(buf, 345, 155, filenameEncoding) + "/" + name;
      } else if (isGNU(buf)) {
      } else {
        if (!allowUnknownFormat) {
          throw new Error("Invalid tar header: unknown format.");
        }
      }
      if (typeflag === 0 && name && name[name.length - 1] === "/") typeflag = 5;
      return {
        name,
        mode,
        uid,
        gid,
        size,
        mtime: new Date(1e3 * mtime),
        type,
        linkname,
        uname,
        gname,
        devmajor,
        devminor,
        pax: null
      };
    };
    function isUSTAR(buf) {
      return b4a.equals(USTAR_MAGIC, buf.subarray(MAGIC_OFFSET, MAGIC_OFFSET + 6));
    }
    function isGNU(buf) {
      return b4a.equals(GNU_MAGIC, buf.subarray(MAGIC_OFFSET, MAGIC_OFFSET + 6)) && b4a.equals(GNU_VER, buf.subarray(VERSION_OFFSET, VERSION_OFFSET + 2));
    }
    function clamp(index, len, defaultValue) {
      if (typeof index !== "number") return defaultValue;
      index = ~~index;
      if (index >= len) return len;
      if (index >= 0) return index;
      index += len;
      if (index >= 0) return index;
      return 0;
    }
    function toType(flag) {
      switch (flag) {
        case 0:
          return "file";
        case 1:
          return "link";
        case 2:
          return "symlink";
        case 3:
          return "character-device";
        case 4:
          return "block-device";
        case 5:
          return "directory";
        case 6:
          return "fifo";
        case 7:
          return "contiguous-file";
        case 72:
          return "pax-header";
        case 55:
          return "pax-global-header";
        case 27:
          return "gnu-long-link-path";
        case 28:
        case 30:
          return "gnu-long-path";
      }
      return null;
    }
    function toTypeflag(flag) {
      switch (flag) {
        case "file":
          return 0;
        case "link":
          return 1;
        case "symlink":
          return 2;
        case "character-device":
          return 3;
        case "block-device":
          return 4;
        case "directory":
          return 5;
        case "fifo":
          return 6;
        case "contiguous-file":
          return 7;
        case "pax-header":
          return 72;
      }
      return 0;
    }
    function indexOf(block, num, offset, end) {
      for (; offset < end; offset++) {
        if (block[offset] === num) return offset;
      }
      return end;
    }
    function cksum(block) {
      let sum = 8 * 32;
      for (let i = 0; i < 148; i++) sum += block[i];
      for (let j = 156; j < 512; j++) sum += block[j];
      return sum;
    }
    function encodeOct(val, n) {
      val = val.toString(8);
      if (val.length > n) return SEVENS.slice(0, n) + " ";
      return ZEROS.slice(0, n - val.length) + val + " ";
    }
    function encodeSizeBin(num, buf, off) {
      buf[off] = 128;
      for (let i = 11; i > 0; i--) {
        buf[off + i] = num & 255;
        num = Math.floor(num / 256);
      }
    }
    function encodeSize(num, buf, off) {
      if (num.toString(8).length > 11) {
        encodeSizeBin(num, buf, off);
      } else {
        b4a.write(buf, encodeOct(num, 11), off);
      }
    }
    function parse256(buf) {
      let positive;
      if (buf[0] === 128) positive = true;
      else if (buf[0] === 255) positive = false;
      else return null;
      const tuple = [];
      let i;
      for (i = buf.length - 1; i > 0; i--) {
        const byte = buf[i];
        if (positive) tuple.push(byte);
        else tuple.push(255 - byte);
      }
      let sum = 0;
      const l = tuple.length;
      for (i = 0; i < l; i++) {
        sum += tuple[i] * Math.pow(256, i);
      }
      return positive ? sum : -1 * sum;
    }
    function decodeOct(val, offset, length) {
      val = val.subarray(offset, offset + length);
      offset = 0;
      if (val[offset] & 128) {
        return parse256(val);
      } else {
        while (offset < val.length && val[offset] === 32) offset++;
        const end = clamp(indexOf(val, 32, offset, val.length), val.length, val.length);
        while (offset < end && val[offset] === 0) offset++;
        if (end === offset) return 0;
        return parseInt(b4a.toString(val.subarray(offset, end)), 8);
      }
    }
    function decodeStr(val, offset, length, encoding) {
      return b4a.toString(val.subarray(offset, indexOf(val, 0, offset, offset + length)), encoding);
    }
    function addLength(str) {
      const len = b4a.byteLength(str);
      let digits = Math.floor(Math.log(len) / Math.log(10)) + 1;
      if (len + digits >= Math.pow(10, digits)) digits++;
      return len + digits + str;
    }
  }
});

// node_modules/tar-stream/extract.js
var require_extract = __commonJS({
  "node_modules/tar-stream/extract.js"(exports2, module2) {
    var { Writable, Readable: Readable3, getStreamError } = require_streamx();
    var FIFO = require_fast_fifo();
    var b4a = require_b4a();
    var headers = require_headers();
    var EMPTY = b4a.alloc(0);
    var BufferList = class {
      constructor() {
        this.buffered = 0;
        this.shifted = 0;
        this.queue = new FIFO();
        this._offset = 0;
      }
      push(buffer) {
        this.buffered += buffer.byteLength;
        this.queue.push(buffer);
      }
      shiftFirst(size) {
        return this._buffered === 0 ? null : this._next(size);
      }
      shift(size) {
        if (size > this.buffered) return null;
        if (size === 0) return EMPTY;
        let chunk = this._next(size);
        if (size === chunk.byteLength) return chunk;
        const chunks = [chunk];
        while ((size -= chunk.byteLength) > 0) {
          chunk = this._next(size);
          chunks.push(chunk);
        }
        return b4a.concat(chunks);
      }
      _next(size) {
        const buf = this.queue.peek();
        const rem = buf.byteLength - this._offset;
        if (size >= rem) {
          const sub = this._offset ? buf.subarray(this._offset, buf.byteLength) : buf;
          this.queue.shift();
          this._offset = 0;
          this.buffered -= rem;
          this.shifted += rem;
          return sub;
        }
        this.buffered -= size;
        this.shifted += size;
        return buf.subarray(this._offset, this._offset += size);
      }
    };
    var Source = class extends Readable3 {
      constructor(self, header, offset) {
        super();
        this.header = header;
        this.offset = offset;
        this._parent = self;
      }
      _read(cb) {
        if (this.header.size === 0) {
          this.push(null);
        }
        if (this._parent._stream === this) {
          this._parent._update();
        }
        cb(null);
      }
      _predestroy() {
        this._parent.destroy(getStreamError(this));
      }
      _detach() {
        if (this._parent._stream === this) {
          this._parent._stream = null;
          this._parent._missing = overflow(this.header.size);
          this._parent._update();
        }
      }
      _destroy(cb) {
        this._detach();
        cb(null);
      }
    };
    var Extract = class extends Writable {
      constructor(opts) {
        super(opts);
        if (!opts) opts = {};
        this._buffer = new BufferList();
        this._offset = 0;
        this._header = null;
        this._stream = null;
        this._missing = 0;
        this._longHeader = false;
        this._callback = noop;
        this._locked = false;
        this._finished = false;
        this._pax = null;
        this._paxGlobal = null;
        this._gnuLongPath = null;
        this._gnuLongLinkPath = null;
        this._filenameEncoding = opts.filenameEncoding || "utf-8";
        this._allowUnknownFormat = !!opts.allowUnknownFormat;
        this._unlockBound = this._unlock.bind(this);
      }
      _unlock(err) {
        this._locked = false;
        if (err) {
          this.destroy(err);
          this._continueWrite(err);
          return;
        }
        this._update();
      }
      _consumeHeader() {
        if (this._locked) return false;
        this._offset = this._buffer.shifted;
        try {
          this._header = headers.decode(this._buffer.shift(512), this._filenameEncoding, this._allowUnknownFormat);
        } catch (err) {
          this._continueWrite(err);
          return false;
        }
        if (!this._header) return true;
        switch (this._header.type) {
          case "gnu-long-path":
          case "gnu-long-link-path":
          case "pax-global-header":
          case "pax-header":
            this._longHeader = true;
            this._missing = this._header.size;
            return true;
        }
        this._locked = true;
        this._applyLongHeaders();
        if (this._header.size === 0 || this._header.type === "directory") {
          this.emit("entry", this._header, this._createStream(), this._unlockBound);
          return true;
        }
        this._stream = this._createStream();
        this._missing = this._header.size;
        this.emit("entry", this._header, this._stream, this._unlockBound);
        return true;
      }
      _applyLongHeaders() {
        if (this._gnuLongPath) {
          this._header.name = this._gnuLongPath;
          this._gnuLongPath = null;
        }
        if (this._gnuLongLinkPath) {
          this._header.linkname = this._gnuLongLinkPath;
          this._gnuLongLinkPath = null;
        }
        if (this._pax) {
          if (this._pax.path) this._header.name = this._pax.path;
          if (this._pax.linkpath) this._header.linkname = this._pax.linkpath;
          if (this._pax.size) this._header.size = parseInt(this._pax.size, 10);
          this._header.pax = this._pax;
          this._pax = null;
        }
      }
      _decodeLongHeader(buf) {
        switch (this._header.type) {
          case "gnu-long-path":
            this._gnuLongPath = headers.decodeLongPath(buf, this._filenameEncoding);
            break;
          case "gnu-long-link-path":
            this._gnuLongLinkPath = headers.decodeLongPath(buf, this._filenameEncoding);
            break;
          case "pax-global-header":
            this._paxGlobal = headers.decodePax(buf);
            break;
          case "pax-header":
            this._pax = this._paxGlobal === null ? headers.decodePax(buf) : Object.assign({}, this._paxGlobal, headers.decodePax(buf));
            break;
        }
      }
      _consumeLongHeader() {
        this._longHeader = false;
        this._missing = overflow(this._header.size);
        const buf = this._buffer.shift(this._header.size);
        try {
          this._decodeLongHeader(buf);
        } catch (err) {
          this._continueWrite(err);
          return false;
        }
        return true;
      }
      _consumeStream() {
        const buf = this._buffer.shiftFirst(this._missing);
        if (buf === null) return false;
        this._missing -= buf.byteLength;
        const drained = this._stream.push(buf);
        if (this._missing === 0) {
          this._stream.push(null);
          if (drained) this._stream._detach();
          return drained && this._locked === false;
        }
        return drained;
      }
      _createStream() {
        return new Source(this, this._header, this._offset);
      }
      _update() {
        while (this._buffer.buffered > 0 && !this.destroying) {
          if (this._missing > 0) {
            if (this._stream !== null) {
              if (this._consumeStream() === false) return;
              continue;
            }
            if (this._longHeader === true) {
              if (this._missing > this._buffer.buffered) break;
              if (this._consumeLongHeader() === false) return false;
              continue;
            }
            const ignore = this._buffer.shiftFirst(this._missing);
            if (ignore !== null) this._missing -= ignore.byteLength;
            continue;
          }
          if (this._buffer.buffered < 512) break;
          if (this._stream !== null || this._consumeHeader() === false) return;
        }
        this._continueWrite(null);
      }
      _continueWrite(err) {
        const cb = this._callback;
        this._callback = noop;
        cb(err);
      }
      _write(data, cb) {
        this._callback = cb;
        this._buffer.push(data);
        this._update();
      }
      _final(cb) {
        this._finished = this._missing === 0 && this._buffer.buffered === 0;
        cb(this._finished ? null : new Error("Unexpected end of data"));
      }
      _predestroy() {
        this._continueWrite(null);
      }
      _destroy(cb) {
        if (this._stream) this._stream.destroy(getStreamError(this));
        cb(null);
      }
      [Symbol.asyncIterator]() {
        let error = null;
        let promiseResolve = null;
        let promiseReject = null;
        let entryStream = null;
        let entryCallback = null;
        const extract = this;
        this.on("entry", onentry);
        this.on("error", (err) => {
          error = err;
        });
        this.on("close", onclose);
        return {
          [Symbol.asyncIterator]() {
            return this;
          },
          next() {
            return new Promise(onnext);
          },
          return() {
            return destroy(null);
          },
          throw(err) {
            return destroy(err);
          }
        };
        function consumeCallback(err) {
          if (!entryCallback) return;
          const cb = entryCallback;
          entryCallback = null;
          cb(err);
        }
        function onnext(resolve, reject) {
          if (error) {
            return reject(error);
          }
          if (entryStream) {
            resolve({ value: entryStream, done: false });
            entryStream = null;
            return;
          }
          promiseResolve = resolve;
          promiseReject = reject;
          consumeCallback(null);
          if (extract._finished && promiseResolve) {
            promiseResolve({ value: void 0, done: true });
            promiseResolve = promiseReject = null;
          }
        }
        function onentry(header, stream, callback) {
          entryCallback = callback;
          stream.on("error", noop);
          if (promiseResolve) {
            promiseResolve({ value: stream, done: false });
            promiseResolve = promiseReject = null;
          } else {
            entryStream = stream;
          }
        }
        function onclose() {
          consumeCallback(error);
          if (!promiseResolve) return;
          if (error) promiseReject(error);
          else promiseResolve({ value: void 0, done: true });
          promiseResolve = promiseReject = null;
        }
        function destroy(err) {
          extract.destroy(err);
          consumeCallback(err);
          return new Promise((resolve, reject) => {
            if (extract.destroyed) return resolve({ value: void 0, done: true });
            extract.once("close", function() {
              if (err) reject(err);
              else resolve({ value: void 0, done: true });
            });
          });
        }
      }
    };
    module2.exports = function extract(opts) {
      return new Extract(opts);
    };
    function noop() {
    }
    function overflow(size) {
      size &= 511;
      return size && 512 - size;
    }
  }
});

// node_modules/tar-stream/constants.js
var require_constants = __commonJS({
  "node_modules/tar-stream/constants.js"(exports2, module2) {
    var constants = {
      // just for envs without fs
      S_IFMT: 61440,
      S_IFDIR: 16384,
      S_IFCHR: 8192,
      S_IFBLK: 24576,
      S_IFIFO: 4096,
      S_IFLNK: 40960
    };
    try {
      module2.exports = require("fs").constants || constants;
    } catch {
      module2.exports = constants;
    }
  }
});

// node_modules/tar-stream/pack.js
var require_pack = __commonJS({
  "node_modules/tar-stream/pack.js"(exports2, module2) {
    var { Readable: Readable3, Writable, getStreamError } = require_streamx();
    var b4a = require_b4a();
    var constants = require_constants();
    var headers = require_headers();
    var DMODE = 493;
    var FMODE = 420;
    var END_OF_TAR = b4a.alloc(1024);
    var Sink = class extends Writable {
      constructor(pack, header, callback) {
        super({ mapWritable, eagerOpen: true });
        this.written = 0;
        this.header = header;
        this._callback = callback;
        this._linkname = null;
        this._isLinkname = header.type === "symlink" && !header.linkname;
        this._isVoid = header.type !== "file" && header.type !== "contiguous-file";
        this._finished = false;
        this._pack = pack;
        this._openCallback = null;
        if (this._pack._stream === null) this._pack._stream = this;
        else this._pack._pending.push(this);
      }
      _open(cb) {
        this._openCallback = cb;
        if (this._pack._stream === this) this._continueOpen();
      }
      _continuePack(err) {
        if (this._callback === null) return;
        const callback = this._callback;
        this._callback = null;
        callback(err);
      }
      _continueOpen() {
        if (this._pack._stream === null) this._pack._stream = this;
        const cb = this._openCallback;
        this._openCallback = null;
        if (cb === null) return;
        if (this._pack.destroying) return cb(new Error("pack stream destroyed"));
        if (this._pack._finalized) return cb(new Error("pack stream is already finalized"));
        this._pack._stream = this;
        if (!this._isLinkname) {
          this._pack._encode(this.header);
        }
        if (this._isVoid) {
          this._finish();
          this._continuePack(null);
        }
        cb(null);
      }
      _write(data, cb) {
        if (this._isLinkname) {
          this._linkname = this._linkname ? b4a.concat([this._linkname, data]) : data;
          return cb(null);
        }
        if (this._isVoid) {
          if (data.byteLength > 0) {
            return cb(new Error("No body allowed for this entry"));
          }
          return cb();
        }
        this.written += data.byteLength;
        if (this._pack.push(data)) return cb();
        this._pack._drain = cb;
      }
      _finish() {
        if (this._finished) return;
        this._finished = true;
        if (this._isLinkname) {
          this.header.linkname = this._linkname ? b4a.toString(this._linkname, "utf-8") : "";
          this._pack._encode(this.header);
        }
        overflow(this._pack, this.header.size);
        this._pack._done(this);
      }
      _final(cb) {
        if (this.written !== this.header.size) {
          return cb(new Error("Size mismatch"));
        }
        this._finish();
        cb(null);
      }
      _getError() {
        return getStreamError(this) || new Error("tar entry destroyed");
      }
      _predestroy() {
        this._pack.destroy(this._getError());
      }
      _destroy(cb) {
        this._pack._done(this);
        this._continuePack(this._finished ? null : this._getError());
        cb();
      }
    };
    var Pack = class extends Readable3 {
      constructor(opts) {
        super(opts);
        this._drain = noop;
        this._finalized = false;
        this._finalizing = false;
        this._pending = [];
        this._stream = null;
      }
      entry(header, buffer, callback) {
        if (this._finalized || this.destroying) throw new Error("already finalized or destroyed");
        if (typeof buffer === "function") {
          callback = buffer;
          buffer = null;
        }
        if (!callback) callback = noop;
        if (!header.size || header.type === "symlink") header.size = 0;
        if (!header.type) header.type = modeToType(header.mode);
        if (!header.mode) header.mode = header.type === "directory" ? DMODE : FMODE;
        if (!header.uid) header.uid = 0;
        if (!header.gid) header.gid = 0;
        if (!header.mtime) header.mtime = /* @__PURE__ */ new Date();
        if (typeof buffer === "string") buffer = b4a.from(buffer);
        const sink = new Sink(this, header, callback);
        if (b4a.isBuffer(buffer)) {
          header.size = buffer.byteLength;
          sink.write(buffer);
          sink.end();
          return sink;
        }
        if (sink._isVoid) {
          return sink;
        }
        return sink;
      }
      finalize() {
        if (this._stream || this._pending.length > 0) {
          this._finalizing = true;
          return;
        }
        if (this._finalized) return;
        this._finalized = true;
        this.push(END_OF_TAR);
        this.push(null);
      }
      _done(stream) {
        if (stream !== this._stream) return;
        this._stream = null;
        if (this._finalizing) this.finalize();
        if (this._pending.length) this._pending.shift()._continueOpen();
      }
      _encode(header) {
        if (!header.pax) {
          const buf = headers.encode(header);
          if (buf) {
            this.push(buf);
            return;
          }
        }
        this._encodePax(header);
      }
      _encodePax(header) {
        const paxHeader = headers.encodePax({
          name: header.name,
          linkname: header.linkname,
          pax: header.pax
        });
        const newHeader = {
          name: "PaxHeader",
          mode: header.mode,
          uid: header.uid,
          gid: header.gid,
          size: paxHeader.byteLength,
          mtime: header.mtime,
          type: "pax-header",
          linkname: header.linkname && "PaxHeader",
          uname: header.uname,
          gname: header.gname,
          devmajor: header.devmajor,
          devminor: header.devminor
        };
        this.push(headers.encode(newHeader));
        this.push(paxHeader);
        overflow(this, paxHeader.byteLength);
        newHeader.size = header.size;
        newHeader.type = header.type;
        this.push(headers.encode(newHeader));
      }
      _doDrain() {
        const drain = this._drain;
        this._drain = noop;
        drain();
      }
      _predestroy() {
        const err = getStreamError(this);
        if (this._stream) this._stream.destroy(err);
        while (this._pending.length) {
          const stream = this._pending.shift();
          stream.destroy(err);
          stream._continueOpen();
        }
        this._doDrain();
      }
      _read(cb) {
        this._doDrain();
        cb();
      }
    };
    module2.exports = function pack(opts) {
      return new Pack(opts);
    };
    function modeToType(mode) {
      switch (mode & constants.S_IFMT) {
        case constants.S_IFBLK:
          return "block-device";
        case constants.S_IFCHR:
          return "character-device";
        case constants.S_IFDIR:
          return "directory";
        case constants.S_IFIFO:
          return "fifo";
        case constants.S_IFLNK:
          return "symlink";
      }
      return "file";
    }
    function noop() {
    }
    function overflow(self, size) {
      size &= 511;
      if (size) self.push(END_OF_TAR.subarray(0, 512 - size));
    }
    function mapWritable(buf) {
      return b4a.isBuffer(buf) ? buf : b4a.from(buf);
    }
  }
});

// node_modules/tar-stream/index.js
var require_tar_stream = __commonJS({
  "node_modules/tar-stream/index.js"(exports2) {
    exports2.extract = require_extract();
    exports2.pack = require_pack();
  }
});

// src/main.ts
var main_exports = {};
__export(main_exports, {
  main: () => main
});
module.exports = __toCommonJS(main_exports);
var import_promises7 = require("node:fs/promises");

// src/auth.ts
var import_promises = require("node:fs/promises");
var maximumTokenLifetimeSeconds = 60 * 60;
var minimumRemainingLifetimeSeconds = 30;
var allowedClockSkewSeconds = 60;
function jwtClaims(token) {
  const segments = token.split(".");
  if (segments.length !== 3 || segments.some((segment) => !segment)) return void 0;
  try {
    const parsed = JSON.parse(Buffer.from(segments[1] ?? "", "base64url").toString("utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : void 0;
  } catch {
    return void 0;
  }
}
function validateShortLivedToken(token, nowSeconds) {
  const claims = jwtClaims(token);
  const issuedAt = claims?.iat;
  const expiresAt = claims?.exp;
  if (!Number.isInteger(issuedAt) || !Number.isInteger(expiresAt) || issuedAt > nowSeconds + allowedClockSkewSeconds || expiresAt - issuedAt > maximumTokenLifetimeSeconds || expiresAt - issuedAt <= 0 || expiresAt - nowSeconds < minimumRemainingLifetimeSeconds) {
    throw new Error("bearer-token file contains an invalid short-lived bearer token");
  }
  return token;
}
function shortLivedBearerTokenFileProvider(path, now = () => Math.floor(Date.now() / 1e3)) {
  return async (signal) => {
    let token;
    try {
      token = (await (0, import_promises.readFile)(path, { encoding: "utf8", signal })).trim();
    } catch {
      if (signal?.aborted) {
        const error = new Error("bearer-token file read was cancelled");
        error.name = "AbortError";
        throw error;
      }
      throw new Error("bearer-token file could not be read");
    }
    return validateShortLivedToken(token, now());
  };
}

// src/config.ts
function required(environment, name) {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`required action input ${name} is missing`);
  }
  return value;
}
function requiredVerbatim(environment, name) {
  const value = environment[name];
  if (!value?.trim()) {
    throw new Error(`required action input ${name} is missing`);
  }
  return value;
}
function readActionConfig(environment) {
  const workflow = environment.STEWARD_RUN_WORKFLOW;
  const invocationPath = environment.STEWARD_RUN_INVOCATION_PATH;
  const agentRuntime = environment.STEWARD_RUN_AGENT_RUNTIME?.trim();
  const identityExchangeUrl = environment.STEWARD_RUN_IDENTITY_EXCHANGE_URL?.trim();
  const identityExchangeAudience = environment.STEWARD_RUN_IDENTITY_EXCHANGE_AUDIENCE?.trim();
  const oidcAudience = environment.STEWARD_RUN_OIDC_AUDIENCE?.trim();
  const bearerTokenFile = environment.STEWARD_RUN_BEARER_TOKEN_FILE?.trim();
  const caCertificateFile = environment.STEWARD_RUN_CA_CERTIFICATE_FILE?.trim();
  const apiUrl = required(environment, "STEWARD_RUN_API_URL");
  const taskSourceCount = [workflow?.trim(), invocationPath].filter(Boolean).length;
  if (taskSourceCount !== 1) {
    throw new Error("configure exactly one Task source: workflow or invocation-path");
  }
  if (invocationPath && agentRuntime) {
    throw new Error("agent-runtime cannot be selected for a direct package invocation");
  }
  if (identityExchangeAudience && !identityExchangeUrl) {
    throw new Error("identity-exchange-audience requires identity-exchange-url");
  }
  const authenticationCount = [identityExchangeUrl, oidcAudience, bearerTokenFile].filter(Boolean).length;
  if (authenticationCount !== 1) {
    throw new Error(
      "configure exactly one authentication method: identity-exchange-url, oidc-audience, or bearer-token-file"
    );
  }
  if (oidcAudience) {
    let api;
    try {
      api = new URL(apiUrl);
    } catch {
      throw new Error("steward-api-url must be a valid URL");
    }
    const loopback = api.hostname === "localhost" || api.hostname === "127.0.0.1" || api.hostname === "::1";
    if (!loopback) {
      throw new Error(
        "direct GitHub OIDC authentication is only allowed with a loopback Steward API"
      );
    }
  }
  const authentication = identityExchangeUrl ? {
    kind: "github-oidc-exchange",
    url: identityExchangeUrl,
    ...identityExchangeAudience ? { audience: identityExchangeAudience } : {}
  } : oidcAudience ? { kind: "github-oidc", audience: oidcAudience } : { kind: "bearer-token-file", path: bearerTokenFile };
  const common = {
    inputPaths: required(environment, "STEWARD_RUN_INPUTS"),
    outputPaths: required(environment, "STEWARD_RUN_OUTPUTS"),
    apiUrl,
    authentication,
    ...caCertificateFile ? { caCertificateFile } : {}
  };
  return invocationPath ? { ...common, invocationPath } : {
    ...common,
    workflow: requiredVerbatim(environment, "STEWARD_RUN_WORKFLOW"),
    ...agentRuntime ? { agentRuntime } : {}
  };
}

// src/failure-metadata.ts
var FAILURE_METADATA_VERSION = "steward-run.failure/v1";
var REQUEST_FAILURE_METADATA_VERSION = "steward-run.request-failure/v1";
var ASSERTION_STAGE_METADATA_VERSION = "steward-run.assertion-stage/v1";
var PROVIDER_CONNECTION_STAGE_METADATA_VERSION = "steward-run.provider-connection-stage/v1";
var PROVIDER_CONNECTION_STAGE_V2_METADATA_VERSION = "steward-run.provider-connection-stage/v2";
var PROVIDER_CONNECTION_STAGE_V3_METADATA_VERSION = "steward-run.provider-connection-stage/v3";
var failurePhases = ["succeeded", "failed", "cancelled", "unavailable"];
var failureCategories = [
  "provider-connection",
  "provider-token-grant",
  "provider-grant",
  "provider-protocol",
  "provider-authorization",
  "provider-upstream",
  "assertion-mismatch",
  "workflow-cleanup",
  "authentication",
  "authorization",
  "validation",
  "conflict",
  "configuration",
  "dependency",
  "transport",
  "malformed-response",
  "input-output",
  "runtime",
  "timeout",
  "execution",
  "cancelled",
  "unknown"
];
var requestStages = ["submit", "upload", "execute", "poll", "output", "finalize"];
var requestFailureCategories = [
  "validation",
  "authentication",
  "authorization",
  "conflict",
  "dependency",
  "timeout",
  "transport",
  "malformed-response"
];
var assertionStages = [
  "input-request",
  "runtime-toolchain",
  "model-result",
  "mcp-tool-event"
];
var providerConnectionStages = [
  "model-proxy-start",
  "model-request",
  "model-gateway",
  "agent-after-model"
];
var providerConnectionStagesV2 = [
  "model-proxy-start",
  "model-request",
  "model-proxy-contract",
  "litellm-http",
  "agent-after-model"
];
var providerConnectionStagesV3 = [
  "model-proxy-start",
  "model-request",
  "model-proxy-contract",
  "litellm-transport",
  "litellm-http",
  "agent-after-model"
];
var cleanupCategories = [
  "confirmed",
  "not-required",
  "request-failed",
  "confirmation-timeout",
  "identity-mismatch",
  "unknown"
];
var agentExitCategories = /* @__PURE__ */ new Map([
  [70, "provider-connection"],
  [71, "provider-token-grant"],
  [72, "provider-authorization"],
  [73, "provider-upstream"],
  [74, "assertion-mismatch"],
  [75, "workflow-cleanup"],
  [76, "provider-grant"],
  [77, "provider-protocol"],
  [78, "assertion-mismatch"],
  [79, "assertion-mismatch"],
  [80, "assertion-mismatch"],
  [81, "assertion-mismatch"],
  [82, "provider-connection"],
  [83, "provider-connection"],
  [84, "provider-connection"],
  [85, "provider-connection"],
  [86, "provider-connection"],
  [87, "provider-connection"]
]);
var agentExitAssertionStages = /* @__PURE__ */ new Map([
  [78, "input-request"],
  [79, "runtime-toolchain"],
  [80, "model-result"],
  [81, "mcp-tool-event"]
]);
var agentExitProviderConnectionStages = /* @__PURE__ */ new Map([
  [82, "model-proxy-start"],
  [83, "model-request"],
  [84, "model-gateway"],
  [85, "agent-after-model"],
  [86, "agent-after-model"],
  [87, "model-gateway"]
]);
var agentExitProviderConnectionStagesV2 = /* @__PURE__ */ new Map([
  [82, "model-proxy-start"],
  [83, "model-request"],
  [84, "model-proxy-contract"],
  [85, "litellm-http"],
  [86, "agent-after-model"],
  [87, "litellm-http"]
]);
var agentExitProviderConnectionStagesV3 = /* @__PURE__ */ new Map([
  [82, "model-proxy-start"],
  [83, "model-request"],
  [84, "model-proxy-contract"],
  [85, "litellm-http"],
  [86, "agent-after-model"],
  [87, "litellm-transport"]
]);
function exactAgentExitCode(reason) {
  if (reason === void 0) return void 0;
  const exactAgentExit = /^task agent exited with code ([0-9]+)$/u.exec(reason.toLowerCase());
  return exactAgentExit ? Number(exactAgentExit[1]) : void 0;
}
function classifyAssertionStage(reason) {
  const code = exactAgentExitCode(reason);
  return code === void 0 ? void 0 : agentExitAssertionStages.get(code);
}
function classifyProviderConnectionStage(reason) {
  const code = exactAgentExitCode(reason);
  return code === void 0 ? void 0 : agentExitProviderConnectionStages.get(code);
}
function classifyProviderConnectionStageV2(reason) {
  const code = exactAgentExitCode(reason);
  return code === void 0 ? void 0 : agentExitProviderConnectionStagesV2.get(code);
}
function classifyProviderConnectionStageV3(reason) {
  const code = exactAgentExitCode(reason);
  return code === void 0 ? void 0 : agentExitProviderConnectionStagesV3.get(code);
}
function classifyFailureReason(reason) {
  if (reason === void 0) return "unknown";
  const exactAgentExit = exactAgentExitCode(reason);
  if (exactAgentExit !== void 0) {
    const code = exactAgentExit;
    return agentExitCategories.get(code) ?? "execution";
  }
  const normalized = reason.trim().toLowerCase();
  const agentExit = /^task agent exited with code ([0-9]+)$/u.exec(normalized);
  if (agentExit) {
    const code = Number(agentExit[1]);
    if (code === 77) return "execution";
    return agentExitCategories.get(code) ?? "execution";
  }
  if (/\b(timeout|timed out|deadline)\b/u.test(normalized)) return "timeout";
  if (/\b(unauthenticated|authentication|oidc|token|credential)\b/u.test(normalized)) {
    return "authentication";
  }
  if (/\b(unauthorized|authorization|forbidden|denied|policy|grant)\b/u.test(normalized)) {
    return "authorization";
  }
  if (/\b(config|configuration|profile|catalog|workflow)\b/u.test(normalized)) {
    return "configuration";
  }
  if (/\b(upstream|unavailable|connection|gateway|provider)\b/u.test(normalized)) {
    return "dependency";
  }
  if (/\b(input|output|archive|artifact)\b/u.test(normalized)) return "input-output";
  if (/\b(runtime|sandbox|openshell|agent)\b/u.test(normalized)) return "runtime";
  if (/\b(execution|command|process|exit|exited)\b/u.test(normalized)) return "execution";
  return "unknown";
}
function allowed(values, value) {
  return typeof value === "string" && values.includes(value);
}
function sanitizeCorrelationId(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u.test(value) ? value : void 0;
}
function sanitizeFailureMetadata(value) {
  const failureCategory = allowed(failureCategories, value.failureCategory) ? value.failureCategory : "unknown";
  const assertionStage = failureCategory === "assertion-mismatch" && allowed(assertionStages, value.assertionStage) ? value.assertionStage : void 0;
  const providerConnectionStage = failureCategory === "provider-connection" && allowed(providerConnectionStages, value.providerConnectionStage) ? value.providerConnectionStage : void 0;
  const providerConnectionStageV2 = failureCategory === "provider-connection" && allowed(providerConnectionStagesV2, value.providerConnectionStageV2) ? value.providerConnectionStageV2 : void 0;
  const providerConnectionStageV3 = failureCategory === "provider-connection" && allowed(providerConnectionStagesV3, value.providerConnectionStageV3) ? value.providerConnectionStageV3 : void 0;
  const requestStage = allowed(requestFailureCategories, failureCategory) && allowed(requestStages, value.requestStage) ? value.requestStage : void 0;
  const httpStatus = requestStage !== void 0 && Number.isInteger(value.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599 ? value.httpStatus : void 0;
  const correlationId = requestStage === void 0 ? void 0 : sanitizeCorrelationId(value.correlationId);
  return {
    version: FAILURE_METADATA_VERSION,
    phase: allowed(failurePhases, value.phase) ? value.phase : "unavailable",
    failureCategory,
    cleanupCategory: allowed(cleanupCategories, value.cleanupCategory) ? value.cleanupCategory : "unknown",
    ...assertionStage === void 0 ? {} : { assertionStage },
    ...providerConnectionStage === void 0 ? {} : { providerConnectionStage },
    ...providerConnectionStageV2 === void 0 ? {} : { providerConnectionStageV2 },
    ...providerConnectionStageV3 === void 0 ? {} : { providerConnectionStageV3 },
    ...requestStage === void 0 ? {} : { requestStage },
    ...httpStatus === void 0 ? {} : { httpStatus },
    ...correlationId === void 0 ? {} : { correlationId }
  };
}
function compact(metadata) {
  return `${FAILURE_METADATA_VERSION} phase=${metadata.phase} failure-category=${metadata.failureCategory} cleanup-category=${metadata.cleanupCategory}`;
}
async function publishFailureMetadata(metadata, sink) {
  const safe = sanitizeFailureMetadata(metadata);
  await sink.writeAnnotation(compact(safe));
  if (safe.requestStage !== void 0) {
    await sink.writeAnnotation(
      `${REQUEST_FAILURE_METADATA_VERSION} stage=${safe.requestStage} category=${safe.failureCategory}${safe.httpStatus === void 0 ? "" : ` status=${safe.httpStatus}`}${safe.correlationId === void 0 ? "" : ` correlation-id=${safe.correlationId}`}`
    );
  }
  if (safe.assertionStage !== void 0) {
    await sink.writeAnnotation(
      `${ASSERTION_STAGE_METADATA_VERSION} stage=${safe.assertionStage}`
    );
  }
  if (safe.providerConnectionStage !== void 0) {
    await sink.writeAnnotation(
      `${PROVIDER_CONNECTION_STAGE_METADATA_VERSION} stage=${safe.providerConnectionStage}`
    );
  }
  if (safe.providerConnectionStageV2 !== void 0) {
    await sink.writeAnnotation(
      `${PROVIDER_CONNECTION_STAGE_V2_METADATA_VERSION} stage=${safe.providerConnectionStageV2}`
    );
  }
  if (safe.providerConnectionStageV3 !== void 0) {
    await sink.writeAnnotation(
      `${PROVIDER_CONNECTION_STAGE_V3_METADATA_VERSION} stage=${safe.providerConnectionStageV3}`
    );
  }
  const summary = [
    "## Steward governed Task failure",
    "",
    "| Contract | Phase | Failure category | Cleanup category |",
    "| --- | --- | --- | --- |",
    `| ${FAILURE_METADATA_VERSION} | ${safe.phase} | ${safe.failureCategory} | ${safe.cleanupCategory} |`
  ];
  if (safe.requestStage !== void 0) {
    summary.push(
      "",
      "| Contract | Request stage | Category | HTTP status | Correlation ID |",
      "| --- | --- | --- | --- | --- |",
      `| ${REQUEST_FAILURE_METADATA_VERSION} | ${safe.requestStage} | ${safe.failureCategory} | ${safe.httpStatus ?? "-"} | ${safe.correlationId ?? "-"} |`
    );
  }
  if (safe.assertionStage !== void 0) {
    summary.push(
      "",
      "| Contract | Assertion stage |",
      "| --- | --- |",
      `| ${ASSERTION_STAGE_METADATA_VERSION} | ${safe.assertionStage} |`
    );
  }
  if (safe.providerConnectionStage !== void 0) {
    summary.push(
      "",
      "| Contract | Provider connection stage |",
      "| --- | --- |",
      `| ${PROVIDER_CONNECTION_STAGE_METADATA_VERSION} | ${safe.providerConnectionStage} |`
    );
  }
  if (safe.providerConnectionStageV2 !== void 0) {
    summary.push(
      "",
      "| Contract | Provider connection stage |",
      "| --- | --- |",
      `| ${PROVIDER_CONNECTION_STAGE_V2_METADATA_VERSION} | ${safe.providerConnectionStageV2} |`
    );
  }
  if (safe.providerConnectionStageV3 !== void 0) {
    summary.push(
      "",
      "| Contract | Provider connection stage |",
      "| --- | --- |",
      `| ${PROVIDER_CONNECTION_STAGE_V3_METADATA_VERSION} | ${safe.providerConnectionStageV3} |`
    );
  }
  summary.push("");
  await sink.writeStepSummary(
    summary.join("\n")
  );
}
var StewardRunFailure = class extends Error {
  metadata;
  constructor(metadata) {
    const safe = sanitizeFailureMetadata(metadata);
    super(
      `Steward governed Task failed (phase=${safe.phase}, failure-category=${safe.failureCategory}, cleanup-category=${safe.cleanupCategory})`
    );
    this.name = "StewardRunFailure";
    this.metadata = safe;
  }
};

// src/oidc.ts
async function getGitHubOidcToken(requestUrl, requestToken, audience, fetchImplementation = fetch, signal) {
  if (!requestUrl || !requestToken) {
    throw new Error(
      "GitHub OIDC is unavailable; grant the job id-token: write permission"
    );
  }
  const url = new URL(requestUrl);
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("GitHub OIDC request URL must use HTTPS except on loopback");
  }
  url.searchParams.set("audience", audience);
  let response;
  try {
    response = await fetchImplementation(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${requestToken}`
      },
      ...signal === void 0 ? {} : { signal }
    });
  } catch {
    if (signal?.aborted) {
      const error = new Error("GitHub OIDC token request was cancelled");
      error.name = "AbortError";
      throw error;
    }
    throw new Error("GitHub OIDC token request failed");
  }
  if (!response.ok) {
    throw new Error(`GitHub OIDC token request failed with status ${response.status}`);
  }
  const payload = await response.json().catch(() => void 0);
  const value = payload && typeof payload === "object" && "value" in payload ? payload.value : void 0;
  if (typeof value !== "string" || value.split(".").length !== 3) {
    throw new Error("GitHub OIDC token response was incompatible");
  }
  return value;
}
function oidcTokenProvider(environment, audience, fetchImplementation = fetch) {
  return async (signal) => getGitHubOidcToken(
    environment.ACTIONS_ID_TOKEN_REQUEST_URL ?? "",
    environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN ?? "",
    audience,
    fetchImplementation,
    signal
  );
}

// src/identity-exchange.ts
var GITHUB_IDENTITY_EXCHANGE_AUDIENCE = "apelogic-github-identity-exchange";
var STEWARD_TASK_API_AUDIENCE = "steward-task-api";
var maximumTokenLifetimeSeconds2 = 60 * 60;
var minimumRemainingLifetimeSeconds2 = 30;
var allowedClockSkewSeconds2 = 60;
function isLoopback(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}
function validateExchangeUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("identity-exchange-url must be a valid URL");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname))) {
    throw new Error("identity-exchange-url must use HTTPS except on loopback");
  }
  if (url.username || url.password || url.hash) {
    throw new Error("identity-exchange-url must not contain credentials or a fragment");
  }
  return url;
}
function jwtClaims2(token) {
  const segments = token.split(".");
  if (segments.length !== 3 || segments.some((segment) => !segment)) return void 0;
  try {
    const parsed = JSON.parse(Buffer.from(segments[1] ?? "", "base64url").toString("utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : void 0;
  } catch {
    return void 0;
  }
}
function hasExactAudience(value, expected) {
  return value === expected || Array.isArray(value) && value.length === 1 && value[0] === expected;
}
function validateStewardToken(token, nowSeconds) {
  const claims = jwtClaims2(token);
  const issuedAt = claims?.iat;
  const expiresAt = claims?.exp;
  if (!hasExactAudience(claims?.aud, STEWARD_TASK_API_AUDIENCE) || !Number.isInteger(issuedAt) || !Number.isInteger(expiresAt) || issuedAt > nowSeconds + allowedClockSkewSeconds2 || expiresAt - issuedAt > maximumTokenLifetimeSeconds2 || expiresAt - issuedAt <= 0 || expiresAt - nowSeconds < minimumRemainingLifetimeSeconds2) {
    throw new Error("identity exchange response was incompatible");
  }
  return token;
}
function identityExchangeTokenProvider(environment, exchangeUrl, sourceFetchImplementation = fetch, now = () => Math.floor(Date.now() / 1e3), audience = GITHUB_IDENTITY_EXCHANGE_AUDIENCE, exchangeFetchImplementation = sourceFetchImplementation) {
  const url = validateExchangeUrl(exchangeUrl);
  const getSourceToken = oidcTokenProvider(
    environment,
    audience,
    sourceFetchImplementation
  );
  return async (signal) => {
    const sourceToken = await getSourceToken(signal);
    let response;
    try {
      response = await exchangeFetchImplementation(url, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${sourceToken}`
        },
        ...signal === void 0 ? {} : { signal }
      });
    } catch {
      if (signal?.aborted) {
        const error = new Error("identity exchange request was cancelled");
        error.name = "AbortError";
        throw error;
      }
      throw new Error("identity exchange request failed");
    }
    if (!response.ok) {
      throw new Error(`identity exchange request failed with status ${response.status}`);
    }
    const payload = await response.json().catch(() => void 0);
    const candidate = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : void 0;
    const token = candidate?.access_token;
    const tokenType = candidate?.token_type;
    const expiresIn = candidate?.expires_in;
    if (typeof token !== "string" || tokenType !== "Bearer" || !Number.isInteger(expiresIn) || expiresIn <= 0 || expiresIn > maximumTokenLifetimeSeconds2) {
      throw new Error("identity exchange response was incompatible");
    }
    return validateStewardToken(token, now());
  };
}

// src/lifecycle.ts
var import_node_crypto3 = require("node:crypto");
var import_promises5 = require("node:timers/promises");

// src/archive.ts
var import_node_fs = require("node:fs");
var import_promises2 = require("node:fs/promises");
var import_node_crypto = require("node:crypto");
var import_node_path = require("node:path");
var import_promises3 = require("node:stream/promises");
var import_tar_stream = __toESM(require_tar_stream(), 1);
var diagnosticsRoot = ".steward/diagnostics";
var stdoutTranscriptPath = `${diagnosticsRoot}/stdout.log`;
var stderrTranscriptPath = `${diagnosticsRoot}/stderr.log`;
var transcriptLimit = 4 * 1024 * 1024;
function invalidWorkspacePath(value) {
  return new Error(`workspace-relative path is invalid: ${JSON.stringify(value)}`);
}
function normalizeWorkspacePath(value) {
  let candidate = value.trim();
  while (candidate.startsWith("./")) candidate = candidate.slice(2);
  if (!candidate || candidate === "." || candidate.includes("\\") || candidate.includes("\0") || import_node_path.posix.isAbsolute(candidate) || import_node_path.win32.isAbsolute(candidate)) {
    throw invalidWorkspacePath(value);
  }
  const normalized = import_node_path.posix.normalize(candidate);
  if (normalized === ".." || normalized.startsWith("../")) {
    throw invalidWorkspacePath(value);
  }
  return normalized;
}
function canonicalInvocationPath(value) {
  if (!value || value.length > 512 || value !== value.trim() || value.includes("\\") || /[\u0000-\u001f\u007f]/u.test(value) || import_node_path.posix.isAbsolute(value) || import_node_path.win32.isAbsolute(value) || import_node_path.posix.normalize(value) !== value || value.split("/").some(
    (component) => !component || component === "." || component === ".." || !/^[A-Za-z0-9._-]+$/u.test(component)
  )) {
    throw new Error("invocation-path must be a canonical repository-relative path");
  }
  return value;
}
async function validateInvocationFile(workspace, value) {
  const relative = canonicalInvocationPath(value);
  let current = workspace;
  const components = relative.split("/");
  for (const [index, component] of components.entries()) {
    current = (0, import_node_path.join)(current, component);
    const metadata = await (0, import_promises2.lstat)(current).catch((error) => {
      if (error.code === "ENOENT") throw new Error("invocation-path does not exist");
      throw error;
    });
    if (metadata.isSymbolicLink()) {
      throw new Error("invocation-path must not contain symbolic links");
    }
    const final = index === components.length - 1;
    if (!final && !metadata.isDirectory() || final && !metadata.isFile()) {
      throw new Error("invocation-path must identify a regular file");
    }
  }
  return relative;
}
function parseWorkspacePaths(source) {
  const paths = [];
  const seen = /* @__PURE__ */ new Set();
  for (const line of source.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    const normalized = normalizeWorkspacePath(line);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      paths.push(normalized);
    }
  }
  if (paths.length === 0) throw invalidWorkspacePath(source);
  return paths;
}
async function collectEntries(workspace, relative, entries) {
  const source = (0, import_node_path.join)(workspace, ...relative.split("/"));
  const metadata = await (0, import_promises2.lstat)(source).catch((error) => {
    if (error.code === "ENOENT") {
      throw new Error(`declared input does not exist: ${relative}`);
    }
    throw error;
  });
  if (metadata.isSymbolicLink()) {
    throw new Error(`symbolic links are not allowed in inputs: ${relative}`);
  }
  if (metadata.isDirectory()) {
    entries.set(relative, {
      name: relative,
      source,
      type: "directory",
      mode: metadata.mode & 511
    });
    const children = await (0, import_promises2.readdir)(source);
    children.sort((left, right) => left.localeCompare(right, "en"));
    for (const child of children) {
      await collectEntries(workspace, import_node_path.posix.join(relative, child), entries);
    }
    return;
  }
  if (!metadata.isFile()) {
    throw new Error(`only regular files and directories are allowed in inputs: ${relative}`);
  }
  entries.set(relative, {
    name: relative,
    source,
    type: "file",
    mode: metadata.mode & 511
  });
}
async function createInputArchive(workspace, paths) {
  const entries = /* @__PURE__ */ new Map();
  for (const path of paths) {
    await collectEntries(workspace, normalizeWorkspacePath(path), entries);
  }
  const ordered = [...entries.values()].sort(
    (left, right) => left.name.localeCompare(right.name, "en")
  );
  const pack = import_tar_stream.default.pack();
  void (async () => {
    try {
      for (const entry of ordered) {
        const header = {
          name: entry.name,
          type: entry.type,
          mode: entry.mode,
          mtime: /* @__PURE__ */ new Date(0),
          uid: 0,
          gid: 0,
          uname: "",
          gname: ""
        };
        if (entry.type === "directory") {
          await new Promise((resolve, reject) => {
            pack.entry(header, (error) => error ? reject(error) : resolve());
          });
        } else {
          const body = await (0, import_promises2.readFile)(entry.source);
          await new Promise((resolve, reject) => {
            pack.entry(header, body, (error) => error ? reject(error) : resolve());
          });
        }
      }
      pack.finalize();
    } catch (error) {
      pack.destroy(error instanceof Error ? error : new Error(String(error)));
    }
  })();
  return pack;
}
function normalizeArchivePath(value) {
  if (!value || value.includes("\\") || value.includes("\0") || import_node_path.posix.isAbsolute(value) || import_node_path.win32.isAbsolute(value)) {
    throw new Error(`unsafe archive path: ${JSON.stringify(value)}`);
  }
  const normalized = import_node_path.posix.normalize(value.replace(/\/$/u, ""));
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`unsafe archive path: ${JSON.stringify(value)}`);
  }
  return normalized;
}
function isDeclaredOutput(path, outputs) {
  return outputs.some((root) => path === root || path.startsWith(`${root}/`));
}
function isStrictAncestorOfDeclaredOutput(path, outputs) {
  return outputs.some((output) => output.startsWith(`${path}/`));
}
async function ensureSafeDirectories(workspace, relativeDirectory) {
  if (!relativeDirectory || relativeDirectory === ".") return;
  let current = workspace;
  for (const component of relativeDirectory.split("/")) {
    current = (0, import_node_path.join)(current, component);
    const metadata = await (0, import_promises2.lstat)(current).catch((error) => {
      if (error.code === "ENOENT") return void 0;
      throw error;
    });
    if (metadata?.isSymbolicLink()) {
      throw new Error(`symbolic link in output path: ${relativeDirectory}`);
    }
    if (metadata && !metadata.isDirectory()) {
      throw new Error(`non-directory in output path: ${relativeDirectory}`);
    }
    if (!metadata) await (0, import_promises2.mkdir)(current);
  }
}
async function writeOutputFile(stream, workspace, relative, mode) {
  const parent = (0, import_node_path.dirname)(relative).split("\\").join("/");
  await ensureSafeDirectories(workspace, parent);
  const target = (0, import_node_path.join)(workspace, ...relative.split("/"));
  const existing = await (0, import_promises2.lstat)(target).catch((error) => {
    if (error.code === "ENOENT") return void 0;
    throw error;
  });
  if (existing?.isSymbolicLink()) throw new Error(`symbolic link in output path: ${relative}`);
  if (existing?.isDirectory()) throw new Error(`output file would replace a directory: ${relative}`);
  const temporary = (0, import_node_path.join)((0, import_node_path.dirname)(target), `.${(0, import_node_path.basename)(target)}.${(0, import_node_crypto.randomUUID)()}.tmp`);
  try {
    await (0, import_promises3.pipeline)(stream, (0, import_node_fs.createWriteStream)(temporary, { flags: "wx", mode: mode ?? 384 }));
    await (0, import_promises2.chmod)(temporary, (mode ?? 384) & 511);
    await (0, import_promises2.rename)(temporary, target);
  } catch (error) {
    await (0, import_promises2.rm)(temporary, { force: true });
    throw error;
  }
}
async function readTranscriptFile(stream, path) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    const value = Buffer.from(chunk);
    size += value.length;
    if (size > transcriptLimit) {
      throw new Error(`execution transcript exceeds ${transcriptLimit} bytes: ${path}`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, size);
}
function isDiagnosticsPath(path) {
  return path === diagnosticsRoot || path.startsWith(`${diagnosticsRoot}/`);
}
function hasCanonicalReservedSpelling(archivePath, normalized, type) {
  const withoutRoot = archivePath.startsWith("./") ? archivePath.slice(2) : archivePath;
  const candidate = type === "directory" && withoutRoot.endsWith("/") ? withoutRoot.slice(0, -1) : withoutRoot;
  return candidate === normalized;
}
async function extractOutputArchive(archive, workspace, declaredPaths, diagnostics = { executionLog: "off" }) {
  const outputs = declaredPaths.map(normalizeWorkspacePath);
  const seen = /* @__PURE__ */ new Set();
  let sawRootDirectory = false;
  let stdout;
  let stderr;
  const extract = import_tar_stream.default.extract();
  extract.on("entry", (header, stream, next) => {
    stream.on("error", () => void 0);
    void (async () => {
      try {
        if (header.name === "./" && header.type === "directory") {
          if (sawRootDirectory) throw new Error("duplicate archive entry: ./");
          sawRootDirectory = true;
          stream.resume();
          next();
          return;
        }
        const relative = normalizeArchivePath(header.name);
        if (isDiagnosticsPath(relative) || diagnostics.executionLog === "full" && relative === ".steward") {
          if (diagnostics.executionLog !== "full") {
            stream.resume();
            throw new Error("reserved diagnostics require full execution logging");
          }
          if (!hasCanonicalReservedSpelling(header.name, relative, header.type)) {
            stream.resume();
            throw new Error("reserved diagnostics archive path is not canonical");
          }
          if (seen.has(relative)) throw new Error(`duplicate archive entry: ${relative}`);
          seen.add(relative);
          if (relative === ".steward" || relative === diagnosticsRoot) {
            if (header.type !== "directory") {
              stream.resume();
              throw new Error(`reserved diagnostics ancestor must be a directory: ${relative}`);
            }
            stream.resume();
          } else if (relative === stdoutTranscriptPath || relative === stderrTranscriptPath) {
            if (header.type !== "file") {
              stream.resume();
              throw new Error(`reserved execution transcript must be a file: ${relative}`);
            }
            const body = await readTranscriptFile(stream, relative);
            if (relative === stdoutTranscriptPath) stdout = body;
            else stderr = body;
          } else {
            stream.resume();
            throw new Error(`unknown reserved diagnostics path: ${relative}`);
          }
          next();
          return;
        }
        const isDeclared = isDeclaredOutput(relative, outputs);
        const isAncestor = isStrictAncestorOfDeclaredOutput(relative, outputs);
        if (!isDeclared && !isAncestor) {
          throw new Error(`archive path is not a declared output: ${relative}`);
        }
        if (seen.has(relative)) throw new Error(`duplicate archive entry: ${relative}`);
        seen.add(relative);
        if (!isDeclared && header.type !== "directory") {
          stream.resume();
          throw new Error(`archive ancestor entry type is not allowed: ${header.type ?? "unknown"}`);
        }
        if (header.type === "directory") {
          stream.resume();
          await ensureSafeDirectories(workspace, relative);
        } else if (header.type === "file") {
          await writeOutputFile(stream, workspace, relative, header.mode);
        } else {
          stream.resume();
          throw new Error(`archive entry type is not allowed: ${header.type ?? "unknown"}`);
        }
        next();
      } catch (error) {
        stream.resume();
        next(error instanceof Error ? error : new Error(String(error)));
      }
    })();
  });
  await (0, import_promises3.pipeline)(archive, extract);
  if (diagnostics.executionLog === "full") {
    if (stdout === void 0 || stderr === void 0) {
      throw new Error("missing reserved execution transcript");
    }
    return { stdout, stderr };
  }
  return void 0;
}

// src/execution-log.ts
var import_node_crypto2 = require("node:crypto");
var sensitiveOutputWarning = "::warning title=Sensitive Steward execution log::Full Task stdout and stderr may contain prompts, repository data, model output, and tool results.\n";
function defaultWrite(channel, value) {
  (channel === "stdout" ? process.stdout : process.stderr).write(value);
}
function safeCommandToken(value) {
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(value)) {
    throw new Error("execution log command token is invalid");
  }
  return value;
}
async function replayStream(label, body, write, commandToken) {
  const channel = label;
  const token = safeCommandToken(commandToken());
  let failure;
  try {
    await write(channel, `::group::Steward Task ${label}
`);
    await write(channel, `::stop-commands::${token}
`);
    await write(channel, body);
    if (body.length === 0 || body.at(-1) !== 10) await write(channel, "\n");
  } catch (error) {
    failure = error;
  }
  try {
    await write(channel, `::${token}::
`);
  } catch (error) {
    failure ??= error;
  }
  try {
    await write(channel, "::endgroup::\n");
  } catch (error) {
    failure ??= error;
  }
  if (failure !== void 0) throw failure;
}
async function replayExecutionTranscript(transcript, dependencies = {}) {
  const write = dependencies.write ?? defaultWrite;
  const commandToken = dependencies.commandToken ?? (() => `steward-${(0, import_node_crypto2.randomUUID)()}`);
  await write("stdout", sensitiveOutputWarning);
  await replayStream("stdout", transcript.stdout, write, commandToken);
  await replayStream("stderr", transcript.stderr, write, commandToken);
}

// src/steward-client.ts
var import_promises4 = require("node:timers/promises");
var import_node_stream = require("node:stream");
var taskPhases = [
  "submitted",
  "parked",
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled"
];
var StewardRequestFailure = class extends Error {
  stage;
  category;
  httpStatus;
  correlationId;
  constructor(stage, category, details = {}) {
    super(
      `Steward request failed (stage=${stage}, category=${category}${details.httpStatus === void 0 ? "" : `, status=${details.httpStatus}`})`
    );
    this.name = "StewardRequestFailure";
    this.stage = stage;
    this.category = category;
    this.httpStatus = details.httpStatus;
    this.correlationId = sanitizeCorrelationId(details.correlationId);
  }
};
function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : void 0;
}
function hasOnlyKeys(value, keys) {
  const allowed2 = new Set(keys);
  return Object.keys(value).every((key) => allowed2.has(key));
}
function parseModelRef(value) {
  const item = record(value);
  return item && hasOnlyKeys(item, ["provider", "model"]) && typeof item.provider === "string" && item.provider && typeof item.model === "string" && item.model ? { provider: item.provider, model: item.model } : void 0;
}
function parseToolGrant(value) {
  const item = record(value);
  return item && hasOnlyKeys(item, ["provider", "resource", "action"]) && typeof item.provider === "string" && item.provider && typeof item.resource === "string" && item.resource && typeof item.action === "string" && item.action ? { provider: item.provider, resource: item.resource, action: item.action } : void 0;
}
function parseItems(value, parse) {
  if (!Array.isArray(value)) return void 0;
  const parsed = value.map(parse);
  return parsed.every((item) => item !== void 0) ? parsed : void 0;
}
function parseTaskDelta(value) {
  const delta = record(value);
  if (!delta || typeof delta.dimension !== "string") return void 0;
  if (delta.dimension === "budget" && hasOnlyKeys(delta, ["dimension", "requested", "ceiling", "currency"]) && typeof delta.requested === "string" && typeof delta.ceiling === "string" && typeof delta.currency === "string") {
    return {
      dimension: "budget",
      requested: delta.requested,
      ceiling: delta.ceiling,
      currency: delta.currency
    };
  }
  if (delta.dimension === "singleRunBudget" && hasOnlyKeys(delta, ["dimension", "requested", "ceiling", "currency"]) && (delta.requested === null || typeof delta.requested === "string") && typeof delta.ceiling === "string" && typeof delta.currency === "string") {
    return {
      dimension: "singleRunBudget",
      requested: delta.requested,
      ceiling: delta.ceiling,
      currency: delta.currency
    };
  }
  if (delta.dimension === "ttl" && hasOnlyKeys(delta, ["dimension", "requested", "ceiling"]) && typeof delta.requested === "string" && typeof delta.ceiling === "string") {
    return { dimension: "ttl", requested: delta.requested, ceiling: delta.ceiling };
  }
  if (delta.dimension === "models" && hasOnlyKeys(delta, ["dimension", "requested", "ceiling"])) {
    const requested = parseItems(delta.requested, parseModelRef);
    const ceiling = parseItems(delta.ceiling, parseModelRef);
    if (requested && ceiling) return { dimension: "models", requested, ceiling };
  }
  if (delta.dimension === "tools" && hasOnlyKeys(delta, ["dimension", "requested", "ceiling"])) {
    const requested = parseItems(delta.requested, parseToolGrant);
    const ceiling = parseItems(delta.ceiling, parseToolGrant);
    if (requested && ceiling) return { dimension: "tools", requested, ceiling };
  }
  if (delta.dimension === "runnerPlatforms" && hasOnlyKeys(delta, ["dimension", "requested", "ceiling"])) {
    const parsePlatform = (item) => item === "linux" || item === "mac" || item === "windows" ? item : void 0;
    const requested = parseItems(delta.requested, parsePlatform);
    const ceiling = parseItems(delta.ceiling, parsePlatform);
    if (requested && ceiling) return { dimension: "runnerPlatforms", requested, ceiling };
  }
  if ((delta.dimension === "runnerMemory" || delta.dimension === "runnerCompute" || delta.dimension === "runnerStorage") && hasOnlyKeys(delta, ["dimension", "requested", "ceiling"]) && typeof delta.requested === "string" && (delta.ceiling === null || typeof delta.ceiling === "string")) {
    return {
      dimension: delta.dimension,
      requested: delta.requested,
      ceiling: delta.ceiling
    };
  }
  return void 0;
}
function parseTaskDiagnostics(value) {
  const diagnostics = record(value);
  return diagnostics && hasOnlyKeys(diagnostics, ["executionLog"]) && (diagnostics.executionLog === "off" || diagnostics.executionLog === "full") ? { executionLog: diagnostics.executionLog } : void 0;
}
function parseDirectTaskEvidence(value) {
  const evidence = record(value);
  if (!evidence || !hasOnlyKeys(evidence, [
    "schemaVersion",
    "taskUid",
    "sourceProvenance",
    "invocation",
    "package",
    "closure",
    "closureDigest",
    "envelope",
    "effectiveRequirements",
    "diagnostics"
  ]) || evidence.schemaVersion !== "steward.task/source-authority-evidence/v1" || typeof evidence.taskUid !== "string" || !evidence.taskUid || typeof evidence.closureDigest !== "string" || !evidence.closureDigest) {
    return void 0;
  }
  const sourceProvenance = record(evidence.sourceProvenance);
  const invocation = record(evidence.invocation);
  const packageSource = record(evidence.package);
  const closure = record(evidence.closure);
  const envelope = record(evidence.envelope);
  const effectiveRequirements = record(evidence.effectiveRequirements);
  const diagnostics = parseTaskDiagnostics(evidence.diagnostics);
  if (!sourceProvenance || !invocation || !packageSource || !closure || !envelope || !effectiveRequirements || !diagnostics) {
    return void 0;
  }
  return {
    schemaVersion: evidence.schemaVersion,
    taskUid: evidence.taskUid,
    sourceProvenance,
    invocation,
    package: packageSource,
    closure,
    closureDigest: evidence.closureDigest,
    envelope,
    effectiveRequirements,
    diagnostics
  };
}
var pendingBindingPhases = /* @__PURE__ */ new Set(["submitted", "parked", "queued"]);
function isPendingBindingTask(task) {
  return task.runtimeUid === null && task.runtimeOwnership === "provisioned" && !task.finalized && pendingBindingPhases.has(task.phase) && task.failureReason === void 0;
}
function isUnboundFinalizationTask(task) {
  return task.runtimeUid === null && task.runtimeOwnership === "provisioned" && task.phase === "cancelled" && task.failureReason === void 0;
}
function parseTask(payload) {
  const value = record(payload);
  const rawDeltas = value?.deltas ?? [];
  const deltas = parseItems(rawDeltas, parseTaskDelta);
  const diagnostics = value?.diagnostics === void 0 ? void 0 : parseTaskDiagnostics(value.diagnostics);
  const evidence = value?.evidence === void 0 ? void 0 : parseDirectTaskEvidence(value.evidence);
  if (!value || !hasOnlyKeys(value, [
    "taskUid",
    "contractVersion",
    "runtimeUid",
    "phase",
    "runtimeOwnership",
    "finalized",
    "failureReason",
    "deltas",
    "diagnostics",
    "evidence"
  ]) || typeof value.taskUid !== "string" || !value.taskUid || value.contractVersion !== void 0 && value.contractVersion !== "steward.task/v2" || value.contractVersion === "steward.task/v2" !== (diagnostics !== void 0) || value.contractVersion === "steward.task/v2" !== (evidence !== void 0) || value.runtimeUid !== null && (typeof value.runtimeUid !== "string" || !value.runtimeUid) || typeof value.phase !== "string" || !taskPhases.includes(value.phase) || value.runtimeOwnership !== "provisioned" && value.runtimeOwnership !== "adopted" || typeof value.finalized !== "boolean" || value.failureReason !== void 0 && typeof value.failureReason !== "string" || !deltas || value.diagnostics !== void 0 && diagnostics === void 0 || value.evidence !== void 0 && evidence === void 0 || evidence !== void 0 && evidence.taskUid !== value.taskUid || evidence !== void 0 && evidence.diagnostics.executionLog !== diagnostics?.executionLog) {
    throw new Error("Steward returned an incompatible Task response");
  }
  const task = {
    ...value.contractVersion === "steward.task/v2" ? { contractVersion: value.contractVersion } : {},
    taskUid: value.taskUid,
    runtimeUid: value.runtimeUid,
    phase: value.phase,
    runtimeOwnership: value.runtimeOwnership,
    finalized: value.finalized,
    ...typeof value.failureReason === "string" ? { failureReason: value.failureReason } : {},
    deltas,
    ...diagnostics === void 0 ? {} : { diagnostics },
    ...evidence === void 0 ? {} : { evidence }
  };
  if (task.runtimeUid === null && !isPendingBindingTask(task) && !isUnboundFinalizationTask(task)) {
    throw new Error("Steward returned a contradictory unbound Task response");
  }
  return task;
}
function validatedBaseUrl(value) {
  const url = new URL(value);
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("Steward API URL must use HTTPS except on loopback");
  }
  if (url.username || url.password || url.hash) {
    throw new Error("Steward API URL must not contain credentials or a fragment");
  }
  url.search = "";
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}
function retryDelay(response, attempt) {
  const retryAfter = response?.headers.get("retry-after");
  if (retryAfter && /^\d+$/u.test(retryAfter)) {
    return Math.min(Number(retryAfter) * 1e3, 3e4);
  }
  return Math.min(250 * 2 ** attempt, 4e3);
}
function isRetryableStatus(status) {
  return status === 429 || status === 502 || status === 503 || status === 504;
}
function transportFailureCategory(error) {
  const candidates = [error];
  if (error && typeof error === "object" && "cause" in error) candidates.push(error.cause);
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const code = "code" in candidate && typeof candidate.code === "string" ? candidate.code : "";
    if (["ECONNABORTED", "ETIMEDOUT"].includes(code)) return "timeout";
  }
  if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) return "timeout";
  return "transport";
}
function httpFailureCategory(status) {
  if (status === 400 || status === 422) return "validation";
  if (status === 401) return "authentication";
  if (status === 403) return "authorization";
  if (status === 409) return "conflict";
  return "dependency";
}
function responseCorrelationId(response) {
  return sanitizeCorrelationId(response.headers.get("x-correlation-id")) ?? sanitizeCorrelationId(response.headers.get("x-request-id"));
}
function requestAbortError() {
  const error = new Error("Steward request was cancelled");
  error.name = "AbortError";
  return error;
}
function requestTimeoutError() {
  const error = new Error("Steward request deadline expired");
  error.name = "TimeoutError";
  return error;
}
async function boundedOperation(operation, options) {
  if (options.signal?.aborted) throw requestAbortError();
  const controller = new AbortController();
  let deadlineExpired = false;
  let timeout;
  const cancel = () => controller.abort();
  options.signal?.addEventListener("abort", cancel, { once: true });
  if (options.deadline !== void 0) {
    const remaining = options.deadline - Date.now();
    if (remaining <= 0) {
      options.signal?.removeEventListener("abort", cancel);
      throw requestTimeoutError();
    }
    timeout = setTimeout(() => {
      deadlineExpired = true;
      controller.abort();
    }, remaining);
  }
  let rejectAbort;
  const aborted = new Promise((_resolve, reject) => {
    rejectAbort = reject;
  });
  const rejectOnAbort = () => {
    rejectAbort?.(
      options.signal?.aborted ? requestAbortError() : deadlineExpired ? requestTimeoutError() : requestAbortError()
    );
  };
  controller.signal.addEventListener("abort", rejectOnAbort, { once: true });
  try {
    return await Promise.race([operation(controller.signal), aborted]);
  } finally {
    if (timeout !== void 0) clearTimeout(timeout);
    options.signal?.removeEventListener("abort", cancel);
    controller.signal.removeEventListener("abort", rejectOnAbort);
  }
}
async function readJsonResponse(response, signal) {
  if (!response.body) return void 0;
  const reader = response.body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => void 0);
  };
  signal.addEventListener("abort", cancel, { once: true });
  const chunks = [];
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      chunks.push(Buffer.from(chunk.value));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}
var StewardClient = class {
  #baseUrl;
  #getToken;
  #fetch;
  #sleep;
  #maxAttempts;
  constructor(options) {
    this.#baseUrl = validatedBaseUrl(options.baseUrl);
    this.#getToken = options.getToken;
    this.#fetch = options.fetch ?? fetch;
    this.#sleep = options.sleep ?? (async (milliseconds, signal) => (0, import_promises4.setTimeout)(milliseconds, void 0, { signal }));
    this.#maxAttempts = options.maxAttempts ?? 4;
  }
  async #request(method, path, options) {
    const url = new URL(path.replace(/^\//u, ""), this.#baseUrl);
    for (let attempt = 0; attempt < this.#maxAttempts; attempt += 1) {
      let response;
      try {
        const token = await boundedOperation(
          (signal) => this.#getToken(signal),
          options
        );
        const body = await boundedOperation(
          async () => typeof options.body === "function" ? options.body() : options.body,
          options
        );
        response = await boundedOperation(
          (signal) => this.#fetch(url, {
            method,
            headers: {
              accept: "application/json",
              authorization: `Bearer ${token}`,
              ...options.headers
            },
            ...body === void 0 ? {} : { body },
            ...options.duplex ? { duplex: options.duplex } : {},
            signal
          }),
          options
        );
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError" && options.signal?.aborted) {
          throw error;
        }
        if (error instanceof Error && error.name === "TimeoutError") {
          throw new StewardRequestFailure(options.stage, "timeout");
        }
        if (attempt + 1 === this.#maxAttempts) {
          throw new StewardRequestFailure(options.stage, transportFailureCategory(error));
        }
        try {
          await boundedOperation(
            (signal) => this.#sleep(retryDelay(void 0, attempt), signal),
            options
          );
        } catch (sleepError) {
          if (sleepError instanceof Error && sleepError.name === "AbortError" && options.signal?.aborted) {
            throw sleepError;
          }
          throw new StewardRequestFailure(
            options.stage,
            transportFailureCategory(sleepError)
          );
        }
        continue;
      }
      const expectedStatuses = Array.isArray(options.expectedStatus) ? options.expectedStatus : [options.expectedStatus];
      if (expectedStatuses.includes(response.status)) return response;
      if (isRetryableStatus(response.status) && attempt + 1 < this.#maxAttempts) {
        await response.body?.cancel().catch(() => void 0);
        try {
          await boundedOperation(
            (signal) => this.#sleep(retryDelay(response, attempt), signal),
            options
          );
        } catch (sleepError) {
          if (sleepError instanceof Error && sleepError.name === "AbortError" && options.signal?.aborted) {
            throw sleepError;
          }
          throw new StewardRequestFailure(
            options.stage,
            transportFailureCategory(sleepError)
          );
        }
        continue;
      }
      await response.body?.cancel().catch(() => void 0);
      const correlationId = responseCorrelationId(response);
      throw new StewardRequestFailure(options.stage, httpFailureCategory(response.status), {
        httpStatus: response.status,
        ...correlationId === void 0 ? {} : { correlationId }
      });
    }
    throw new StewardRequestFailure(options.stage, "transport");
  }
  async #taskResponse(response, stage, options = {}) {
    let payload;
    try {
      payload = await boundedOperation(
        (signal) => readJsonResponse(response, signal),
        options
      );
    } catch (error) {
      await response.body?.cancel().catch(() => void 0);
      if (error instanceof Error && error.name === "AbortError" && options.signal?.aborted) {
        throw error;
      }
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new StewardRequestFailure(stage, "timeout");
      }
      payload = void 0;
    }
    try {
      const task = parseTask(payload);
      if (task.runtimeUid === null) {
        const operationAllowsNull = stage === "submit" && response.status === 202 && isPendingBindingTask(task) || stage === "poll" && (isPendingBindingTask(task) || isUnboundFinalizationTask(task)) || stage === "finalize" && isUnboundFinalizationTask(task);
        if (!operationAllowsNull) {
          throw new Error("Steward returned an unbound Task in an incompatible response");
        }
      }
      return task;
    } catch {
      const correlationId = responseCorrelationId(response);
      throw new StewardRequestFailure(stage, "malformed-response", {
        httpStatus: response.status,
        ...correlationId === void 0 ? {} : { correlationId }
      });
    }
  }
  async submitTask(request, idempotencyKey) {
    const response = await this.#request("POST", "v1/tasks", {
      stage: "submit",
      expectedStatus: [201, 202],
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey
      },
      body: JSON.stringify(request)
    });
    return this.#taskResponse(response, "submit");
  }
  async uploadTaskInputs(taskUid, createArchive) {
    await this.#request("PUT", `v1/tasks/${encodeURIComponent(taskUid)}/inputs`, {
      stage: "upload",
      expectedStatus: 204,
      headers: { "content-type": "application/x-tar" },
      body: async () => await createArchive(),
      duplex: "half"
    });
  }
  async executeTask(taskUid) {
    return this.#taskResponse(
      await this.#request("POST", `v1/tasks/${encodeURIComponent(taskUid)}/execute`, {
        stage: "execute",
        expectedStatus: 202
      }),
      "execute"
    );
  }
  async getTask(taskUid, options = {}) {
    return this.#taskResponse(
      await this.#request("GET", `v1/tasks/${encodeURIComponent(taskUid)}`, {
        stage: "poll",
        expectedStatus: 200,
        ...options.signal === void 0 ? {} : { signal: options.signal },
        ...options.deadline === void 0 ? {} : { deadline: options.deadline }
      }),
      "poll",
      options
    );
  }
  async downloadTaskOutputs(taskUid) {
    const response = await this.#request(
      "GET",
      `v1/tasks/${encodeURIComponent(taskUid)}/outputs`,
      {
        stage: "output",
        expectedStatus: 200,
        headers: { accept: "application/x-tar" }
      }
    );
    if (!response.headers.get("content-type")?.startsWith("application/x-tar") || !response.body) {
      const correlationId = responseCorrelationId(response);
      throw new StewardRequestFailure("output", "malformed-response", {
        httpStatus: response.status,
        ...correlationId === void 0 ? {} : { correlationId }
      });
    }
    return import_node_stream.Readable.fromWeb(response.body);
  }
  async finalizeTask(taskUid) {
    return this.#taskResponse(
      await this.#request("DELETE", `v1/tasks/${encodeURIComponent(taskUid)}`, {
        stage: "finalize",
        expectedStatus: 202
      }),
      "finalize"
    );
  }
};

// src/lifecycle.ts
var terminalPhases = /* @__PURE__ */ new Set(["succeeded", "failed", "cancelled"]);
var runtimeBindingPollAttempts = 60;
var runtimeBindingTimeoutMilliseconds = 10 * 60 * 1e3;
function identityField(environment, name) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`required GitHub job identity ${name} is missing`);
  return value;
}
function createIdempotencyKey(environment) {
  const identity = [
    identityField(environment, "GITHUB_REPOSITORY"),
    identityField(environment, "GITHUB_RUN_ID"),
    identityField(environment, "GITHUB_RUN_ATTEMPT"),
    identityField(environment, "GITHUB_JOB")
  ].join("\0");
  return (0, import_node_crypto3.createHash)("sha256").update(identity).digest("hex");
}
function abortError() {
  const error = new Error("Steward Task was cancelled");
  error.name = "AbortError";
  return error;
}
function timeoutError() {
  return new StewardRequestFailure("poll", "timeout");
}
function boundTask(task) {
  return task.runtimeUid === null ? void 0 : task;
}
function taskContractMatches(initial, current) {
  return initial.contractVersion === current.contractVersion && initial.diagnostics?.executionLog === current.diagnostics?.executionLog;
}
async function abortable(operation, signal) {
  if (signal.aborted) throw abortError();
  let rejectAbort;
  const aborted = new Promise((_resolve, reject) => {
    rejectAbort = reject;
  });
  const cancel = () => rejectAbort?.(abortError());
  signal.addEventListener("abort", cancel, { once: true });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}
function assertPreExecutionTask(task) {
  if (task.finalized || terminalPhases.has(task.phase)) {
    throw new Error("Steward bound Task in an incompatible pre-execution state");
  }
  return task;
}
async function pollUntilRuntimeBound(initial, client, sleep, signal, timeoutMilliseconds = runtimeBindingTimeoutMilliseconds) {
  const alreadyBound = boundTask(initial);
  if (alreadyBound) return assertPreExecutionTask(alreadyBound);
  const controller = new AbortController();
  let deadlineExpired = false;
  const timeout = Math.max(1, timeoutMilliseconds);
  const deadline = Date.now() + timeout;
  const expire = setTimeout(() => {
    deadlineExpired = true;
    controller.abort();
  }, timeout);
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) controller.abort();
  try {
    let interval = 250;
    for (let attempt = 0; attempt < runtimeBindingPollAttempts; attempt += 1) {
      if (controller.signal.aborted) {
        if (signal?.aborted) throw abortError();
        throw timeoutError();
      }
      await abortable(sleep(interval, controller.signal), controller.signal);
      const current = await abortable(
        client.getTask(initial.taskUid, {
          signal: controller.signal,
          deadline
        }),
        controller.signal
      );
      if (current.taskUid !== initial.taskUid || current.runtimeOwnership !== initial.runtimeOwnership || !taskContractMatches(initial, current)) {
        throw new Error("Steward changed Task identity while waiting for runtime binding");
      }
      if (current.runtimeUid === null && current.phase === "cancelled") throw abortError();
      const currentBound = boundTask(current);
      if (currentBound) return assertPreExecutionTask(currentBound);
      interval = Math.min(interval * 2, 1e4);
    }
    throw timeoutError();
  } catch (error) {
    if (controller.signal.aborted) {
      if (signal?.aborted) throw abortError();
      if (deadlineExpired) throw timeoutError();
    }
    throw error;
  } finally {
    clearTimeout(expire);
    signal?.removeEventListener("abort", cancel);
  }
}
async function pollUntilTerminal(initial, client, sleep, signal) {
  let current = initial;
  let interval = 1e3;
  while (!terminalPhases.has(current.phase)) {
    if (signal?.aborted) throw abortError();
    await sleep(interval, signal);
    if (signal?.aborted) throw abortError();
    current = await client.getTask(current.taskUid);
    if (current.taskUid !== initial.taskUid || current.runtimeUid !== initial.runtimeUid || current.runtimeOwnership !== initial.runtimeOwnership || !taskContractMatches(initial, current)) {
      throw new Error("Steward changed Task identity while polling");
    }
    interval = Math.min(interval * 2, 1e4);
  }
  return current;
}
var FinalizationFailure = class extends Error {
  category;
  constructor(category) {
    super("Steward Task finalization failed");
    this.name = "FinalizationFailure";
    this.category = category;
  }
};
async function finalizeAndConfirm(task, client, sleep) {
  try {
    let finalizationRuntimeUid = task.runtimeUid;
    let current = await client.finalizeTask(task.taskUid);
    if (current.taskUid !== task.taskUid || current.runtimeOwnership !== task.runtimeOwnership || !taskContractMatches(task, current) || finalizationRuntimeUid !== null && current.runtimeUid !== finalizationRuntimeUid) {
      throw new FinalizationFailure("identity-mismatch");
    }
    finalizationRuntimeUid ??= current.runtimeUid;
    for (let attempt = 0; !current.finalized && attempt < 120; attempt += 1) {
      await sleep(Math.min(250 * 2 ** attempt, 2e3));
      current = await client.getTask(task.taskUid);
      if (current.taskUid !== task.taskUid || current.runtimeOwnership !== task.runtimeOwnership || !taskContractMatches(task, current) || finalizationRuntimeUid !== null && current.runtimeUid !== finalizationRuntimeUid) {
        throw new FinalizationFailure("identity-mismatch");
      }
      finalizationRuntimeUid ??= current.runtimeUid;
    }
    if (!current.finalized) throw new FinalizationFailure("confirmation-timeout");
  } catch (error) {
    if (error instanceof FinalizationFailure) throw error;
    throw new FinalizationFailure("request-failed");
  }
}
function taskFailurePhase(task) {
  if (task?.phase === "succeeded" || task?.phase === "failed" || task?.phase === "cancelled") {
    return task.phase;
  }
  return "unavailable";
}
function stageFailureCategory(stage, error) {
  if (error instanceof StewardRequestFailure) return error.category;
  if (error instanceof Error && error.name === "AbortError") return "cancelled";
  if (error instanceof Error && error.name === "TimeoutError") return "timeout";
  switch (stage) {
    case "input":
    case "upload":
    case "output":
      return "input-output";
    case "execute":
      return "execution";
    case "submit":
    case "poll":
      return "dependency";
  }
}
async function runWorkflow(config, workspace, dependencies) {
  let initialArchive;
  let inputPaths = [];
  let outputPaths = [];
  const createArchive = async () => {
    if (initialArchive) {
      const archive = initialArchive;
      initialArchive = void 0;
      return archive;
    }
    return createInputArchive(workspace, inputPaths);
  };
  const sleep = dependencies.sleep ?? (async (milliseconds, signal) => (0, import_promises5.setTimeout)(milliseconds, void 0, { signal }));
  let created;
  let terminal;
  let result;
  let failurePhase = "unavailable";
  let failureCategory = "unknown";
  let assertionStage;
  let providerConnectionStage;
  let providerConnectionStageV2;
  let providerConnectionStageV3;
  let requestStage;
  let httpStatus;
  let correlationId;
  let failed = false;
  let stage = "input";
  try {
    inputPaths = parseWorkspacePaths(config.inputPaths);
    outputPaths = parseWorkspacePaths(config.outputPaths);
    if ("invocationPath" in config) {
      await validateInvocationFile(workspace, config.invocationPath);
    }
    initialArchive = await createInputArchive(workspace, inputPaths);
    stage = "submit";
    created = await dependencies.client.submitTask(
      "invocationPath" in config ? {
        contractVersion: "steward.task/v2",
        invocationPath: config.invocationPath
      } : {
        workflow: config.workflow,
        ...config.agentRuntime ? { agentRuntimeUid: config.agentRuntime } : {}
      },
      createIdempotencyKey(dependencies.environment)
    );
    if ("invocationPath" in config && (created.contractVersion !== "steward.task/v2" || created.diagnostics === void 0)) {
      throw new Error("Steward omitted the direct Task contract projection");
    }
    if (!("invocationPath" in config) && (created.contractVersion !== void 0 || created.diagnostics !== void 0)) {
      throw new Error("Steward returned a direct Task projection for a legacy request");
    }
    const expectedOwnership = "agentRuntime" in config && config.agentRuntime ? "adopted" : "provisioned";
    if (created.runtimeOwnership !== expectedOwnership) {
      throw new Error("Steward returned Task ownership inconsistent with the submission");
    }
    await dependencies.setOutput("task-uid", created.taskUid);
    stage = "poll";
    const bound = await pollUntilRuntimeBound(
      created,
      dependencies.client,
      sleep,
      dependencies.signal,
      dependencies.runtimeBindingTimeoutMilliseconds
    );
    created = bound;
    await dependencies.setOutput("runtime-uid", bound.runtimeUid);
    stage = "upload";
    await dependencies.client.uploadTaskInputs(bound.taskUid, createArchive);
    stage = "execute";
    const executing = await dependencies.client.executeTask(bound.taskUid);
    const executingBound = boundTask(executing);
    if (!executingBound || executingBound.taskUid !== bound.taskUid || executingBound.runtimeUid !== bound.runtimeUid || executingBound.runtimeOwnership !== bound.runtimeOwnership || !taskContractMatches(bound, executingBound)) {
      throw new Error("Steward changed Task identity while requesting execution");
    }
    stage = "poll";
    terminal = await pollUntilTerminal(
      executingBound,
      dependencies.client,
      sleep,
      dependencies.signal
    );
    failurePhase = taskFailurePhase(terminal);
    if (terminal.phase !== "succeeded") {
      failed = true;
      failureCategory = terminal.phase === "cancelled" ? "cancelled" : classifyFailureReason(terminal.failureReason);
      assertionStage = terminal.phase === "cancelled" ? void 0 : classifyAssertionStage(terminal.failureReason);
      providerConnectionStage = terminal.phase === "cancelled" ? void 0 : classifyProviderConnectionStage(terminal.failureReason);
      providerConnectionStageV2 = terminal.phase === "cancelled" ? void 0 : classifyProviderConnectionStageV2(terminal.failureReason);
      providerConnectionStageV3 = terminal.phase === "cancelled" ? void 0 : classifyProviderConnectionStageV3(terminal.failureReason);
    }
    await dependencies.setOutput("status", terminal.phase);
    if (!failed) {
      stage = "output";
      const transcript = await extractOutputArchive(
        await dependencies.client.downloadTaskOutputs(terminal.taskUid),
        workspace,
        outputPaths,
        terminal.diagnostics ?? { executionLog: "off" }
      );
      if (transcript) {
        await replayExecutionTranscript(transcript, {
          ...dependencies.writeLog === void 0 ? {} : { write: dependencies.writeLog },
          ...dependencies.commandToken === void 0 ? {} : { commandToken: dependencies.commandToken }
        });
      }
      result = terminal;
    }
  } catch (error) {
    if (!failed) {
      failed = true;
      failurePhase = terminal ? taskFailurePhase(terminal) : error instanceof Error && error.name === "AbortError" ? "cancelled" : "unavailable";
      failureCategory = stageFailureCategory(stage, error);
      if (error instanceof StewardRequestFailure) {
        requestStage = error.stage;
        httpStatus = error.httpStatus;
        correlationId = error.correlationId;
      }
    }
    if (created && error instanceof Error && error.name === "AbortError") {
      try {
        await dependencies.setOutput("status", "cancelled");
      } catch {
      }
    }
  }
  let cleanupCategory = "not-required";
  if (created) {
    try {
      await finalizeAndConfirm(created, dependencies.client, sleep);
      cleanupCategory = "confirmed";
    } catch (error) {
      cleanupCategory = error instanceof FinalizationFailure ? error.category : "unknown";
      failed = true;
      failurePhase = terminal ? taskFailurePhase(terminal) : failurePhase;
    }
  }
  if (failed || !result) {
    throw new StewardRunFailure({
      version: FAILURE_METADATA_VERSION,
      phase: failurePhase,
      failureCategory,
      cleanupCategory,
      ...assertionStage === void 0 ? {} : { assertionStage },
      ...providerConnectionStage === void 0 ? {} : { providerConnectionStage },
      ...providerConnectionStageV2 === void 0 ? {} : { providerConnectionStageV2 },
      ...providerConnectionStageV3 === void 0 ? {} : { providerConnectionStageV3 },
      ...requestStage === void 0 ? {} : { requestStage },
      ...httpStatus === void 0 ? {} : { httpStatus },
      ...correlationId === void 0 ? {} : { correlationId }
    });
  }
  return result;
}

// src/transport.ts
var import_node_crypto4 = require("node:crypto");
var import_promises6 = require("node:fs/promises");
var import_node_http = require("node:http");
var import_node_https = require("node:https");
var import_node_stream2 = require("node:stream");
var certificatePattern = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/gu;
async function trustedCaBundle(path) {
  let source;
  try {
    source = await (0, import_promises6.readFile)(path, "utf8");
  } catch {
    throw new Error("Steward CA certificate file could not be read");
  }
  const certificates = source.match(certificatePattern) ?? [];
  const remainder = source.replace(certificatePattern, "").trim();
  try {
    if (!certificates.length || remainder) throw new Error("invalid bundle");
    for (const pem of certificates) {
      if (!new import_node_crypto4.X509Certificate(pem).ca) throw new Error("certificate is not a CA");
    }
  } catch {
    throw new Error("Steward CA certificate file does not contain a valid CA certificate");
  }
  return certificates.join("\n");
}
function headersFrom(response) {
  const headers = new Headers();
  for (let index = 0; index < response.rawHeaders.length; index += 2) {
    const name = response.rawHeaders[index];
    const value = response.rawHeaders[index + 1];
    if (name && value !== void 0) headers.append(name, value);
  }
  return headers;
}
function pipeBody(body, request) {
  body.once("error", (error) => request.destroy(error));
  body.pipe(request);
}
function isAsyncIterableBody(value) {
  return Symbol.asyncIterator in value && typeof value[Symbol.asyncIterator] === "function";
}
function writeBody(request, body) {
  if (body === void 0 || body === null) {
    request.end();
  } else if (typeof body === "string" || body instanceof Uint8Array || body instanceof ArrayBuffer) {
    request.end(body);
  } else if (body instanceof URLSearchParams) {
    request.end(body.toString());
  } else if (body instanceof import_node_stream2.Readable) {
    pipeBody(body, request);
  } else if (typeof body === "object" && isAsyncIterableBody(body)) {
    pipeBody(import_node_stream2.Readable.from(body), request);
  } else if (typeof body === "object" && "getReader" in body) {
    pipeBody(
      import_node_stream2.Readable.fromWeb(body),
      request
    );
  } else {
    request.destroy(new Error("unsupported Steward request body"));
  }
}
function privateCaFetch(ca) {
  return async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const method = (init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const requestHeaders = new Headers(
      init.headers ?? (input instanceof Request ? input.headers : void 0)
    );
    return new Promise((resolve, reject) => {
      const handleResponse = (response) => {
        const status = response.statusCode ?? 500;
        const noBody = method === "HEAD" || status === 204 || status === 205 || status === 304;
        const responseInit = {
          status,
          ...response.statusMessage ? { statusText: response.statusMessage } : {},
          headers: headersFrom(response)
        };
        if (noBody) {
          let settled = false;
          const cleanup = () => {
            response.off("end", onEnd);
            response.off("error", onError);
            response.off("aborted", onAborted);
            response.off("close", onClose);
          };
          const onEnd = () => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(new Response(null, responseInit));
          };
          const onError = (error) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(error);
          };
          const onAborted = () => onError(new Error("Steward response was aborted"));
          const onClose = () => {
            if (!response.complete) onError(new Error("Steward response closed prematurely"));
          };
          response.once("end", onEnd);
          response.once("error", onError);
          response.once("aborted", onAborted);
          response.once("close", onClose);
          response.resume();
          return;
        }
        resolve(
          new Response(
            import_node_stream2.Readable.toWeb(response),
            responseInit
          )
        );
      };
      const outgoingHeaders = {};
      requestHeaders.forEach((value, name) => {
        outgoingHeaders[name] = value;
      });
      const options = {
        method,
        headers: outgoingHeaders
      };
      const request = url.protocol === "https:" ? (0, import_node_https.request)(url, { ...options, ca, rejectUnauthorized: true }, handleResponse) : url.protocol === "http:" ? (0, import_node_http.request)(url, options, handleResponse) : void 0;
      if (!request) {
        reject(new Error("unsupported Steward URL protocol"));
        return;
      }
      request.once("error", reject);
      writeBody(request, init.body ?? (input instanceof Request ? input.body : void 0));
    });
  };
}
async function createStewardFetch(caCertificateFile) {
  if (!caCertificateFile) return fetch;
  return privateCaFetch(await trustedCaBundle(caCertificateFile));
}

// src/main.ts
function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`required GitHub environment ${name} is missing`);
  return value;
}
async function setActionOutput(name, value) {
  if (!/^[a-z-]+$/u.test(name) || /[\r\n]/u.test(value)) {
    throw new Error("refusing to write an unsafe GitHub Actions output");
  }
  await (0, import_promises7.appendFile)(requiredEnvironment("GITHUB_OUTPUT"), `${name}=${value}
`, {
    encoding: "utf8"
  });
}
function safeFailure(error) {
  if (error instanceof StewardRunFailure) return error;
  const metadata = {
    version: FAILURE_METADATA_VERSION,
    phase: "unavailable",
    failureCategory: "unknown",
    cleanupCategory: "not-required"
  };
  return new StewardRunFailure(metadata);
}
async function reportActionFailure(failure) {
  await publishFailureMetadata(failure.metadata, {
    writeAnnotation: async (value) => {
      process.stdout.write(`::error title=Steward governed Task failed::${value}
`);
    },
    writeStepSummary: async (value) => {
      const path = process.env.GITHUB_STEP_SUMMARY?.trim();
      if (!path) return;
      try {
        await (0, import_promises7.appendFile)(path, value, { encoding: "utf8" });
      } catch {
      }
    }
  });
}
async function main() {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    const config = readActionConfig(process.env);
    const stewardFetch = await createStewardFetch(config.caCertificateFile);
    const getToken = (() => {
      switch (config.authentication.kind) {
        case "github-oidc-exchange":
          return identityExchangeTokenProvider(
            process.env,
            config.authentication.url,
            void 0,
            void 0,
            config.authentication.audience,
            stewardFetch
          );
        case "github-oidc":
          return oidcTokenProvider(process.env, config.authentication.audience);
        case "bearer-token-file":
          return shortLivedBearerTokenFileProvider(config.authentication.path);
      }
    })();
    const client = new StewardClient({
      baseUrl: config.apiUrl,
      getToken,
      fetch: stewardFetch
    });
    await runWorkflow(config, requiredEnvironment("GITHUB_WORKSPACE"), {
      client,
      environment: process.env,
      setOutput: setActionOutput,
      signal: controller.signal
    });
  } catch (error) {
    const failure = safeFailure(error);
    await reportActionFailure(failure);
    throw failure;
  } finally {
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
  }
}
if (process.env.STEWARD_RUN_WORKFLOW !== void 0 || process.env.STEWARD_RUN_INVOCATION_PATH !== void 0) {
  main().catch((error) => {
    process.stderr.write(`steward-run: ${safeFailure(error).message}
`);
    process.exitCode = 1;
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  main
});
